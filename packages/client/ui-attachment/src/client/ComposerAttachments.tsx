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
  attachments, canAcceptDrop, onAddImages, onRemoveImage, dropLimits, warning, directory, t,
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
  const [preview, setPreview] = useState<ComposerAttachment | null>(null)
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
      if (canAcceptDrop) onAddImages([...dataTransfer.files])
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
  }, [canAcceptDrop, onAddImages])

  const railItems = useMemo<ComposerRailItem[]>(() => attachments.map(attachment => ({
    id: attachment.id,
    previewUrl: attachment.previewUrl,
    alt: attachment.file.name || t('image.pending'),
    removeLabel: t('image.remove', { name: attachment.file.name }),
    warning: effectiveWarning,
    attachment,
  })), [attachments, t, effectiveWarning])

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
            onOpen={(item) => { setPreview(item.attachment) }}
            onRemove={(item) => { onRemoveImage(item.attachment.id) }}
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
