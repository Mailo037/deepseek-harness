import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type {
  ComposerAttachment, ComposerAttachmentsProps,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { AttachmentRail } from '../AttachmentRail.tsx'
import type { AttachmentRailItem } from '../AttachmentRail.tsx'
import { DropOverlay } from '../DropOverlay.tsx'
import { ImageLightbox } from '../ImageLightbox.tsx'
import { attachmentRailLabels, dropOverlayLabels, lightboxLabels } from './labels.ts'
import css from './ComposerAttachments.module.css'

/** Model description structure from the directory store. */
interface ModelCatalogModelLike {
  id: string
  name?: string
  inputModalities?: string[]
}

interface ModelProviderGroupLike {
  provider: string
  models: readonly ModelCatalogModelLike[]
}

interface ModelDirectorySnapshotLike {
  current: { provider?: string; model?: string } | null
  groups: readonly ModelProviderGroupLike[]
}

export interface ComposerAttachmentsInjected {
  directory?: {
    subscribe: (fn: () => void) => () => void
    getSnapshot: () => ModelDirectorySnapshotLike | null
  } | undefined
}

/** Rail item retaining its browser-owned attachment for callbacks. */
interface ComposerRailItem extends AttachmentRailItem {
  attachment: ComposerAttachment
}

/**
 * Format a byte count into a human-readable size string (e.g. `12.3 KB`).
 * Uses one decimal place; larger values climb B → KB → MB.
 * @param bytes - integer byte count.
 * @returns formatted size with unit suffix.
 */
function formatSize(bytes: number): string {
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB']
  const unit = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const value = bytes / 1024 ** unit
  return `${value.toFixed(1)} ${units[unit]}`
}

/**
 * Decode one image URL and report its natural pixel size.
 * @param url - object or data URL of the browser-owned image.
 * @returns natural width and height in pixels.
 */
function measureImage(url: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight })
    image.onerror = () => reject(new Error('image decode failed'))
    image.src = url
  })
}

/**
 * Evaluate the per-image resolution criteria against one decoded size.
 * @param width - natural width in pixels.
 * @param height - natural height in pixels.
 * @param limits - projected per-image bounds.
 * @param t - conversation-namespace translate.
 * @returns the localized warning text, or null when every criterion passes.
 */
export function imageSizeWarning(
  width: number,
  height: number,
  limits: { readonly maxPixels: number; readonly maxDimension: number },
  t: ComposerAttachmentsProps['t'],
): string | null {
  if (width * height > limits.maxPixels) return t('image.tooManyPixels')
  if (Math.max(width, height) > limits.maxDimension) {
    return t('image.dimensionTooLarge', { size: String(limits.maxDimension) })
  }
  return null
}

/** Check whether a model ID or catalog entry lacks image capability. */
function isModelMissingImageSupport(
  modelId: string | undefined,
  groups: readonly ModelProviderGroupLike[] | undefined,
): boolean {
  if (!modelId) return false
  if (groups) {
    for (const group of groups) {
      for (const m of group.models) {
        if (m.id === modelId) {
          if (m.inputModalities && m.inputModalities.length > 0) {
            return !m.inputModalities.includes('image')
          }
          if (
            modelId.includes('vision')
            || modelId.includes('gemini')
            || modelId.includes('ox-alpha')
            || modelId.includes('vl')
            || modelId.includes('grok-4')
            || modelId.includes('seed-2')
          ) {
            return false
          }
          return true
        }
      }
    }
  }
  if (
    modelId.includes('vision')
    || modelId.includes('gemini')
    || modelId.includes('ox-alpha')
    || modelId.includes('vl')
    || modelId.includes('grok-4')
    || modelId.includes('seed-2')
  ) {
    return false
  }
  if (
    modelId.startsWith('deepseek-v4')
    || modelId.startsWith('deepseek-v3')
    || modelId.includes('llama')
    || modelId.includes('mistral')
    || modelId.includes('qwen-2.5')
    || modelId.includes('r1')
  ) {
    return true
  }
  return false
}

/** Draft-image rail, document drop target, and original-image preview slot entry. */
export function ComposerAttachments({
  attachments, canAcceptDrop, onAddFiles, onRemoveAttachment, onRestoreText,
  dropLimits, imagePixelLimits, warning, directory, t,
}: ComposerAttachmentsProps & ComposerAttachmentsInjected) {
  const dirState = useSyncExternalStore(
    fn => (directory ? directory.subscribe(fn) : () => {}),
    () => (directory ? directory.getSnapshot() : null),
  )

  const isModelMissingImage = useMemo(() => {
    if (!dirState?.current?.model) return false
    return isModelMissingImageSupport(dirState.current.model, dirState.groups)
  }, [dirState?.current?.model, dirState?.groups])

  const effectiveWarning = warning ?? (isModelMissingImage ? t('image.modelUnsupported') : undefined)
  // Per-image resolution warnings (id → localized text), measured once per
  // draft attachment against the projected pixel bounds.
  const [sizeWarnings, setSizeWarnings] = useState<ReadonlyMap<string, string>>(new Map())
  const measuredIds = useRef(new Set<string>())
  useEffect(() => {
    if (imagePixelLimits === undefined) return
    const imageIds = new Set<string>()
    for (const attachment of attachments) {
      if (attachment.kind !== 'image') continue
      imageIds.add(attachment.id)
      if (measuredIds.current.has(attachment.id)) continue
      measuredIds.current.add(attachment.id)
      void measureImage(attachment.previewUrl).then(
        ({ width, height }) => {
          const warningText = imageSizeWarning(width, height, imagePixelLimits, t)
          if (warningText === null) return
          setSizeWarnings(prev => new Map(prev).set(attachment.id, warningText))
        },
        () => {
          // A URL that cannot decode owns no client-side verdict; the Host
          // admission still enforces its own bounds at submit.
        },
      )
    }
    // Drop entries whose attachment left the draft (removed, pruned, released).
    setSizeWarnings((prev) => {
      const next = new Map([...prev].filter(([id]) => imageIds.has(id)))
      return next.size === prev.size ? prev : next
    })
  }, [attachments, imagePixelLimits, t])
  const [preview, setPreview] = useState<ComposerAttachment & { kind: 'image' } | null>(null)
  const [dragActive, setDragActive] = useState(false)
  const dragDepth = useRef(0)
  const closePreview = useCallback(() => { setPreview(null) }, [])

  useEffect(() => {
    if (preview !== null && !attachments.some(attachment => attachment.id === preview.id)) setPreview(null)
  }, [attachments, preview])

  useEffect(() => {
    const fileTransfer = (event: globalThis.DragEvent): DataTransfer | null => {
      const dataTransfer = event.dataTransfer
      if (dataTransfer === null || !dataTransfer.types.includes('Files')) return null
      return dataTransfer
    }
    const reset = (): void => {
      dragDepth.current = 0
      setDragActive(false)
    }
    const onDragEnter = (event: globalThis.DragEvent): void => {
      if (fileTransfer(event) === null) return
      event.preventDefault()
      dragDepth.current += 1
      setDragActive(true)
    }
    const onDragOver = (event: globalThis.DragEvent): void => {
      const dataTransfer = fileTransfer(event)
      if (dataTransfer === null) return
      event.preventDefault()
      dataTransfer.dropEffect = canAcceptDrop ? 'copy' : 'none'
    }
    const onDragLeave = (event: globalThis.DragEvent): void => {
      if (fileTransfer(event) === null) return
      dragDepth.current = Math.max(0, dragDepth.current - 1)
      if (dragDepth.current === 0) setDragActive(false)
      const leftViewport = event.clientX <= 0 || event.clientY <= 0
        || event.clientX >= window.innerWidth || event.clientY >= window.innerHeight
      if ((event.target === document.documentElement || event.target === document.body) && leftViewport) reset()
    }
    const onDrop = (event: globalThis.DragEvent): void => {
      const dataTransfer = fileTransfer(event)
      if (dataTransfer === null) return
      event.preventDefault()
      reset()
      if (canAcceptDrop) onAddFiles([...dataTransfer.files])
    }
    document.addEventListener('dragenter', onDragEnter)
    document.addEventListener('dragover', onDragOver)
    document.addEventListener('dragleave', onDragLeave)
    document.addEventListener('drop', onDrop)
    window.addEventListener('dragend', reset)
    return () => {
      document.removeEventListener('dragenter', onDragEnter)
      document.removeEventListener('dragover', onDragOver)
      document.removeEventListener('dragleave', onDragLeave)
      document.removeEventListener('drop', onDrop)
      window.removeEventListener('dragend', reset)
    }
  }, [canAcceptDrop, onAddFiles])

  const railItems = useMemo<ComposerRailItem[]>(() => attachments.map((attachment) => {
    // The specific resolution warning outranks the global model warning.
    const itemWarning = sizeWarnings.get(attachment.id) ?? effectiveWarning
    if (attachment.kind === 'image') {
      return {
        id: attachment.id,
        previewUrl: attachment.previewUrl,
        alt: attachment.file.name || t('image.pending'),
        removeLabel: t('image.remove', { name: attachment.file.name }),
        warning: itemWarning,
        attachment,
      }
    }
    const name = attachment.name || t('image.pending')
    const sizeText = formatSize(attachment.size)
    const item: ComposerRailItem = {
      id: attachment.id,
      previewUrl: '',
      alt: name,
      removeLabel: t('file.remove', { name }),
      file: { name, sizeText },
      warning: itemWarning,
      attachment,
    }
    if (attachment.kind === 'text' && attachment.restorable === true) {
      item.restoreLabel = t('file.restore', { name })
    }
    return item
  }), [attachments, t, effectiveWarning, sizeWarnings])

  return (
    <>
      {dragActive && (
        <DropOverlay
          disabled={!canAcceptDrop}
          labels={dropOverlayLabels(t, canAcceptDrop, dropLimits)}
        />
      )}
      {railItems.length > 0 && (
        <div className={css.rail}>
          <AttachmentRail
            items={railItems}
            labels={attachmentRailLabels(t)}
            onOpen={(item) => {
              if (item.attachment.kind === 'image') setPreview(item.attachment)
            }}
            onRemove={(item) => { onRemoveAttachment(item.attachment.id) }}
            onRestore={(item) => { onRestoreText(item.attachment.id) }}
          />
        </div>
      )}
      {preview !== null && (
        <ImageLightbox
          src={preview.previewUrl}
          alt={preview.file.name || t('image.original')}
          labels={lightboxLabels(t)}
          onClose={closePreview}
        />
      )}
    </>
  )
}
