/**
 * Scope-addressed conversation send, cancel, and history orchestration.
 *
 * Scope addressing rides the cordis Service tracker: property access through
 * `ctx.conversation` rebinds `this.ctx` to the caller's context, so methods
 * read the session tag with `scopeOf`. Mutable state must remain reachable
 * through one property read; assignment through the tracker proxy and `#`
 * private fields bypass that rebinding.
 */
import { Service } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'
// Type-only imports: a plugin-to-plugin value import is a bundle purity
// error, so scope resolution goes through the sessions service (scopeOf
// method) instead of the standalone helper.
import type { ISessions, SessionFace, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { SubmitImageAttachment, SubmitOutcome } from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import type { ImageAttachmentRef, ImageMediaType } from '@deepseek-ai/dsh-attachment'
import type { ComposerAttachment } from './contract/slots.ts'
import type { QueueAction, QueueItemId } from './contract/queue.ts'
import type { ComposerBlocks } from './input/blocks.ts'
import type { DraftAttachmentId, SessionInputResolver } from './input/contract.ts'
import type { InputSubmitMode } from './contract/composer-submission.ts'

/**
 * The outward conversation face (`ctx.conversation`): the scope-addressed
 * verbs and the input registry other plugins may reach — and exactly what a
 * test fake must supply.
 */
export interface IConversation {
  /** The per-session input machine registry (SessionInputResolver face). */
  readonly input: SessionInputResolver
  /**
   * The per-session composer-block registry: how a plugin the composer
   * cannot import makes a session's input inert with its own reason.
   */
  readonly blocks: ComposerBlocks
  /**
   * Send a prompt into the caller scope's session.
   * @param text - prompt text, sent verbatim as one text block.
   * @param mode - 'queue' appends the prompt as a queued turn; 'prepend'
   *   delivers it as the immediate next turn ahead of every already-queued
   *   one (the turn-error retry delivery).
   * @returns completion; business failures reject (and land in promptError).
   */
  send(text: string, mode: 'queue' | 'prepend'): Promise<void>
  /**
   * Apply one edit, remove, or strict steer operation to a pending queue occurrence.
   * @param itemId - agent-owned inbox occurrence identity.
   * @param action - requested queue operation.
   * @returns completion; converged strict-steer races resolve, while other failures reject.
   */
  updateQueue(itemId: QueueItemId, action: QueueAction): Promise<void>
  /**
   * Cancel the scoped session's in-flight turn while preserving its pending Queue.
   * @returns completion; failures reject as in send.
   */
  cancel(): Promise<void>
  /**
   * Pull one older history page for the scoped session.
   * @returns completion of the page pull.
   */
  loadOlder(): Promise<void>
  /**
   * Re-run the scoped session's history open after a failed open (the
   * error-state retry control).
   * @returns completion of the open flow.
   */
  reloadHistory(): Promise<void>
  /**
   * Resolve a durable image reference for one rendered session.
   * @param sessionId - owning session authorization scope.
   * @param attachment - durable image reference.
   * @returns browser URL valid until the rendered session releases it.
   */
  resolveImage(sessionId: SessionId, attachment: ImageAttachmentRef): Promise<string>
}

/** Create one browser-only draft descriptor; only its id enters input state. */
function browserDraftAttachment(file: File): Extract<ComposerAttachment, { kind: 'image' }> {
  return {
    kind: 'image',
    id: crypto.randomUUID() as DraftAttachmentId,
    previewUrl: URL.createObjectURL(file),
    file,
  }
}

interface ImageUrlEntry {
  readonly sessionId: SessionId
  readonly generation: number
  readonly pending: Promise<string>
}

/** Unsupported browser-declared image type, localized by the UI boundary. */
export class UnsupportedImageMediaTypeError extends Error {
  /** Browser-declared MIME value, possibly empty. */
  readonly mediaType: string

  /** @param mediaType - Browser-declared MIME value, possibly empty. */
  constructor(mediaType: string) {
    super(`unsupported image media type: ${mediaType || '(empty)'}`)
    this.name = 'UnsupportedImageMediaTypeError'
    this.mediaType = mediaType
  }
}

/** Scope-addressed conversation service (root singleton, provided as `conversation`). */
export class ConversationController extends Service implements IConversation {
  /** The per-session input machine registry (SessionInputResolver face). */
  readonly input: SessionInputResolver
  /** The per-session composer-block registry. */
  readonly blocks: ComposerBlocks
  private readonly draftRegistry = new Map<DraftAttachmentId, ComposerAttachment>()
  private readonly imageUrls = new Map<string, ImageUrlEntry>()
  private readonly imageGenerations = new Map<SessionId, number>()
  private readonly createdImageUrls = new Set<string>()
  private disposed = false

  /**
   * @param ctx - owning root context (the plugin apply context; the service
   * registers itself and follows that fiber's lifetime).
   * @param config - carries the SessionInputResolver and composer-block registry
   * constructed by the plugin apply (the same instances the slot inject
   * factories close over).
   */
  constructor(ctx: Context, config: { input: SessionInputResolver; blocks: ComposerBlocks }) {
    super(ctx, 'conversation')
    this.input = config.input
    this.blocks = config.blocks
    ctx.effect(() => () => {
      this.disposed = true
      for (const url of this.createdImageUrls) revokePreview(url)
      this.createdImageUrls.clear()
      this.draftRegistry.clear()
      this.imageUrls.clear()
      this.imageGenerations.clear()
    }, 'conversation attachment URL cache')
  }

  /**
   * Send a prompt into the scoped session. Business failures also land in the
   * session snapshot's promptError (object-layer state); the rejection here
   * exists for caller choreography (the composer restores the draft on it).
   * @param text - prompt text, sent verbatim as one text block.
   * @param mode - delivery placement: 'queue' appends, 'prepend' jumps the
   *   prompt to the front of the pending turn queue.
   */
  async send(text: string, mode: 'queue' | 'prepend' = 'queue'): Promise<void> {
    const session = this.scopedSession('send')
    const result = await session.prompt([{ type: 'text', text }], mode)
    if (!result.ok) throw new Error(`conversation.send failed: ${result.error.code}: ${result.error.message}`)
  }

  /**
   * Submit ordered draft attachments with text through one host admission.
   * Images ride as image blocks, text attachments as fenced prompt text, and
   * workspace files as a path reference the agent resolves with its read
   * tools — every block is part of the durable user message.
   * @param session - target session.
   * @param text - serialized prompt text.
   * @param attachmentIds - ordered draft-local attachment ids.
   * @param mode - queue or steer delivery selected by composer policy.
   * @param signal - optional cancellation for the complete Host admission.
   * @returns the Host admission outcome; local attachment preparation failures reject.
   */
  async sendSession(
    session: SessionFace,
    text: string,
    attachmentIds: readonly DraftAttachmentId[],
    mode: InputSubmitMode,
    signal?: AbortSignal,
  ): Promise<SubmitOutcome> {
    const attachments = this.draftAttachments(attachmentIds)
    if (attachments.length !== attachmentIds.length) {
      throw new Error('conversation.sendSession: one or more draft attachments are no longer available')
    }
    const parts: Parameters<SessionFace['prompt']>[0] = []
    for (const attachment of attachments) {
      if (attachment.kind === 'image') parts.push({ type: 'image', ...await this.encodeImage(attachment.file) })
      else if (attachment.kind === 'text') parts.push({ type: 'text', text: textFileBlock(attachment.name, attachment.content) })
      else parts.push({ type: 'text', text: workspaceFileBlock(attachment.path) })
    }
    if (text !== '') parts.push({ type: 'text', text })
    const result = await session.prompt(parts, mode, signal)
    if (!result.ok) return { kind: 'error' }
    this.releaseDraftAttachments(attachments)
    return { kind: 'success' }
  }

  /**
   * Create runtime-only draft images and their object URLs.
   * @param files - browser image files to register after MIME validation.
   * @returns ordered draft descriptors.
   */
  createDraftAttachments(files: readonly File[]): readonly ComposerAttachment[] {
    for (const file of files) imageMediaType(file.type)
    return files.map((file) => {
      const attachment = browserDraftAttachment(file)
      this.draftRegistry.set(attachment.id, attachment)
      this.createdImageUrls.add(attachment.previewUrl)
      return attachment
    })
  }

  /**
   * Register one converted large paste (or small text file) as a draft text
   * attachment; its content rides the prompt as fenced text at submit.
   * @param name - display and prompt-block file name.
   * @param content - full text content.
   * @param restorable - whether the rail offers the put-back-into-draft action
   * (true for paste conversions, false for picked text files).
   * @returns the registered descriptor.
   */
  createTextAttachment(name: string, content: string, restorable: boolean): ComposerAttachment {
    const attachment: ComposerAttachment = {
      kind: 'text',
      id: crypto.randomUUID() as DraftAttachmentId,
      name,
      size: content.length,
      content,
      ...(restorable ? { restorable: true } : {}),
    }
    this.draftRegistry.set(attachment.id, attachment)
    return attachment
  }

  /**
   * Upload one browser file into the session's project directory and register
   * the result as a draft workspace-file attachment; its prompt block carries
   * only the returned workspace-relative path.
   * @param sessionId - session whose project directory receives the upload.
   * @param file - browser file to upload.
   * @returns the registered descriptor.
   */
  async uploadDraftFile(sessionId: SessionId, file: File): Promise<ComposerAttachment> {
    const session = this.requireSessions().binding(sessionId)?.session
    if (session === undefined) {
      throw new Error(`conversation.uploadDraftFile: unknown session "${sessionId}"`)
    }
    const data = bytesToBase64(new Uint8Array(await file.arrayBuffer()))
    const result = await session.uploadAttachment(file.name, data)
    if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`)
    const attachment: ComposerAttachment = {
      kind: 'workspace-file',
      id: crypto.randomUUID() as DraftAttachmentId,
      name: file.name,
      size: file.size,
      path: result.value.path,
    }
    this.draftRegistry.set(attachment.id, attachment)
    return attachment
  }

  /**
   * Resolve ordered input-state ids to runtime-owned draft images.
   * @param ids - draft attachment ids.
   * @returns descriptors that remain live, in requested order.
   */
  draftAttachments(ids: readonly DraftAttachmentId[]): readonly ComposerAttachment[] {
    const attachments: ComposerAttachment[] = []
    for (const id of ids) {
      const attachment = this.draftRegistry.get(id)
      if (attachment !== undefined) attachments.push(attachment)
    }
    return attachments
  }

  /**
   * Serialize ordered draft images to command-submit wire payloads without
   * sending or releasing them (the composer releases only after the command
   * settles successfully). The command plane accepts image attachments only;
   * a non-image draft attachment rejects with {@link NonImageDraftAttachmentError}.
   * @param attachmentIds - ordered draft-local attachment ids.
   * @returns base64 payloads in id order.
   */
  async serializeCommandImages(attachmentIds: readonly DraftAttachmentId[]): Promise<readonly SubmitImageAttachment[]> {
    const attachments = this.draftAttachments(attachmentIds)
    if (attachments.length !== attachmentIds.length) {
      throw new Error('conversation.serializeCommandImages: one or more draft attachments are no longer available')
    }
    return Promise.all(attachments.map((attachment) => {
      if (attachment.kind !== 'image') throw new NonImageDraftAttachmentError(attachment.name)
      return this.encodeImage(attachment.file)
    }))
  }

  /**
   * Release one browser-owned draft attachment and, for images, its preview URL.
   * @param id - draft attachment id.
   */
  releaseDraftAttachment(id: DraftAttachmentId): void {
    const attachment = this.draftRegistry.get(id)
    if (attachment === undefined) return
    this.draftRegistry.delete(id)
    if (attachment.kind === 'image') {
      this.createdImageUrls.delete(attachment.previewUrl)
      revokePreview(attachment.previewUrl)
    }
  }

  /**
   * Release a set of browser-owned draft attachments.
   * @param attachments - descriptors to release.
   */
  releaseDraftAttachments(attachments: readonly ComposerAttachment[]): void {
    for (const attachment of attachments) this.releaseDraftAttachment(attachment.id)
  }

  /**
   * Resolve and cache one session-authorized historical image URL.
   * @param sessionId - owning session authorization scope.
   * @param attachment - durable image reference.
   * @returns browser URL valid until its rendered session is released.
   */
  resolveImage(sessionId: SessionId, attachment: ImageAttachmentRef): Promise<string> {
    if (this.disposed) return Promise.reject(new Error('conversation.resolveImage: service is disposed'))
    const key = `${sessionId}:${attachment.attachmentId}`
    const cached = this.imageUrls.get(key)
    if (cached !== undefined) return cached.pending
    const generation = this.imageGenerations.get(sessionId) ?? 0
    const session = this.requireSessions().binding(sessionId)?.session
    if (session === undefined) {
      return Promise.reject(new Error(`conversation.resolveImage: unknown session "${sessionId}"`))
    }
    const pending = session.readAttachment(attachment.attachmentId)
      .then((result) => {
        if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`)
        if (this.disposed) throw new Error('conversation.resolveImage: service was disposed before loading completed')
        if ((this.imageGenerations.get(sessionId) ?? 0) !== generation) {
          throw new Error('historical image scope was released before loading completed')
        }
        if (typeof URL.createObjectURL !== 'function') {
          return `data:${result.value.attachment.mediaType};base64,${bytesToBase64(result.value.data)}`
        }
        const bytes = Uint8Array.from(result.value.data)
        const url = URL.createObjectURL(new Blob([bytes.buffer], { type: result.value.attachment.mediaType }))
        this.createdImageUrls.add(url)
        return url
      })
      .catch((error: unknown) => {
        if (this.imageUrls.get(key)?.generation === generation) this.imageUrls.delete(key)
        throw error
      })
    this.imageUrls.set(key, { sessionId, generation, pending })
    return pending
  }

  /**
   * Release every historical image URL owned by one rendered session.
   * @param sessionId - rendered session scope.
   */
  releaseSessionImages(sessionId: SessionId): void {
    this.imageGenerations.set(sessionId, (this.imageGenerations.get(sessionId) ?? 0) + 1)
    for (const [key, entry] of this.imageUrls) {
      if (entry.sessionId !== sessionId) continue
      this.imageUrls.delete(key)
      void entry.pending.then((url) => {
        if (!this.createdImageUrls.delete(url)) return
        revokePreview(url)
      }, () => {
        // A failed or invalidated load owns no object URL.
      })
    }
  }

  /** Apply one operation to a pending queue occurrence. */
  async updateQueue(itemId: QueueItemId, action: QueueAction): Promise<void> {
    const session = this.scopedSession('updateQueue')
    const result = await session.updateQueue(itemId, action)
    if (!result.ok) {
      if (
        action.kind === 'steer'
        && (result.error.code === 'steer-unavailable' || result.error.code === 'queue-item-not-found')
      ) return
      throw new Error(`conversation.updateQueue failed: ${result.error.code}: ${result.error.message}`)
    }
  }

  /** Cancel the scoped session's in-flight turn while preserving Queue (failures land in promptError and reject, as in send). */
  async cancel(): Promise<void> {
    const session = this.scopedSession('cancel')
    const result = await session.cancel()
    if (!result.ok) throw new Error(`conversation.cancel failed: ${result.error.code}: ${result.error.message}`)
  }

  /** Pull one older history page for the scoped Session. */
  async loadOlder(): Promise<void> {
    await this.scopedSession('loadOlder').loadOlder()
  }

  /** Re-run the scoped Session's history open (the error-state retry control). */
  async reloadHistory(): Promise<void> {
    await this.scopedSession('reloadHistory').reloadHistory()
  }

  /** Resolve the caller scope's session face or throw on root contexts. */
  private scopedSession(op: string): SessionFace {
    const id = this.scopeId(op)
    const binding = this.requireSessions().binding(id)
    if (binding === undefined) throw new Error(`conversation.${op}: session "${id}" resolved no binding`)
    return binding.session
  }

  /** Read the caller's session scope tag via the sessions service; root contexts fail loud. */
  private scopeId(op: string): SessionId {
    const id = this.requireSessions().scopeOf(this.ctx)
    if (id === undefined) {
      throw new Error(`conversation.${op} requires a session scope — address one via ctx.sessions.scope(id).conversation`)
    }
    return id
  }

  private requireSessions(): ISessions {
    // Strict ctx.get, not the injection proxy: the scope-addressed pattern
    // reads the service off whatever context the tracker rebound.
    const sessions = this.ctx.get('sessions')
    if (sessions === undefined) throw new Error('conversation: sessions service unavailable')
    return sessions
  }

  /** Canonical base64 wire form of one browser image file. */
  private async encodeImage(file: File): Promise<SubmitImageAttachment> {
    return {
      mediaType: imageMediaType(file.type),
      data: bytesToBase64(new Uint8Array(await file.arrayBuffer())),
      ...(file.name === '' ? {} : { name: file.name }),
    }
  }
}

/**
 * Whether the browser-declared MIME type is one of the fixed wire image types.
 * @param value - Browser-declared MIME type.
 * @returns Whether the value is a supported image media type.
 */
export function isImageMediaType(value: string): boolean {
  return value === 'image/png' || value === 'image/jpeg' || value === 'image/webp' || value === 'image/gif'
}

/**
 * A claimed command that accepts attachments met a non-image draft
 * attachment; the UI boundary localizes the rejection.
 */
export class NonImageDraftAttachmentError extends Error {
  /** @param name - offending attachment display name. */
  constructor(name: string) {
    super(`command attachments accept images only: ${name}`)
    this.name = 'NonImageDraftAttachmentError'
  }
}

/** Model-facing prompt block for one inline text attachment. */
function textFileBlock(name: string, content: string): string {
  // A fence longer than any backtick run inside the content cannot be closed early.
  const longestRun = content.split('\n').reduce((max, line) => {
    for (const match of line.matchAll(/`+/g)) max = Math.max(max, match[0].length)
    return max
  }, 0)
  const fence = '`'.repeat(Math.max(3, longestRun + 1))
  return `[Attached file: ${name}]\n${fence}\n${content}\n${fence}`
}

/** Model-facing prompt block for one workspace-uploaded file attachment. */
function workspaceFileBlock(path: string): string {
  return `[Attached file uploaded to the workspace: ${path} — read it with your file tools]`
}

function imageMediaType(value: string): ImageMediaType {
  switch (value) {
    case 'image/png':
    case 'image/jpeg':
    case 'image/webp':
    case 'image/gif':
      return value
    default:
      throw new UnsupportedImageMediaTypeError(value)
  }
}

function bytesToBase64(data: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let offset = 0; offset < data.length; offset += chunk) {
    binary += String.fromCharCode(...data.subarray(offset, offset + chunk))
  }
  return btoa(binary)
}

function revokePreview(url: string): void {
  if (url.startsWith('blob:')) URL.revokeObjectURL(url)
}

/** Fixed byte cap for text files that ride the prompt inline; larger ones upload into the workspace. */
export const INLINE_TEXT_MAX_BYTES = 1_000_000

/** Fixed paste length (UTF-16 code units) at which pasted text converts into a restorable file attachment. */
export const LARGE_PASTE_CHARS = 50_000

/**
 * Read one browser file as text, or null when it is binary. Classification is
 * the NUL-byte probe over the first 8 KiB — every format the composer cannot
 * represent (PDF, images, archives) carries zero bytes there, while textual
 * formats (including UTF-16 files, whose NULs sit at odd offsets… also caught)
 * stay decodable downstream by the browser's own UTF-8 path.
 * @param file - browser file to classify and read.
 * @returns the full text, or null for a binary file.
 */
export async function readDraftFileText(file: File): Promise<string | null> {
  const head = new Uint8Array(await file.slice(0, 8192).arrayBuffer())
  if (head.includes(0)) return null
  return file.text()
}
