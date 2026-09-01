// Read-image toolview: successful read_image calls lead with the durable image
// they inspected. The model-facing envelope remains available behind a compact
// disclosure instead of competing with the preview in the tool flow.

import { useState } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import { IconBrowseOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ToolCallBlock } from '@deepseek-ai/dsh-client-runtime/client'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { ToolCallViewProps } from '../../contract/slots.ts'
import { toolRowModel } from '../models/tool-call-model.ts'
import { ToolRow } from '../components/ToolRow.tsx'
import { CONVERSATION_NS as NS } from '../../locale.ts'
import css from './read-image-row.module.css'

/** Full row props: the toolview runtime share plus the standard locale seat. */
type ReadImageRowProps = ToolCallViewProps & PropsLocale<'conversation'>

/** Return the durable image that a successful image-read result logged. */
function readImageAttachment(block: ToolCallBlock): ImageAttachmentRef | undefined {
  if (!('kind' in block) || block.isError) return undefined
  return block.content.find(content => content.type === 'image')?.attachment
}

/**
 * Read-image row: a square preview opens its original through the shared
 * attachment renderer; the exact text result remains a deliberate info
 * disclosure for paths, dimensions, media type, and byte count.
 */
export function ReadImageRow({ block, cwd, home, openFile, inspect, renderMessageImages, t }: ReadImageRowProps) {
  const model = toolRowModel('read', block, cwd, home)
  const image = readImageAttachment(block)
  const [infoOpen, setInfoOpen] = useState(false)
  if (image === undefined) {
    return (
      <ToolRow
        t={t}
        variant="read"
        toolName="read_image"
        icon={<IconBrowseOutline16 size={14} />}
        title={t('tool.readImage')}
        summary={model.summary}
        body={null}
        output={model.output}
        errorSummary={model.errorSummary}
        state={model.state}
        filePath={model.filePath}
        onOpenFile={openFile}
        inspect={inspect}
      />
    )
  }
  return (
    <section className={css.root} data-read-image>
      <div className={css.heading}>
        <IconBrowseOutline16 size={14} />
        <span className={css.title}>{t('tool.readImage')}</span>
        <span className={css.separator} aria-hidden />
        <button type="button" className={css.path} onClick={() => { openFile(model.filePath ?? model.summary) }}>
          {model.summary}
        </button>
      </div>
      <div className={css.previewRow}>
        {renderMessageImages({ images: [{ attachment: image }], align: 'start', variant: 'tile' })}
        <button
          type="button"
          className={css.infoButton}
          aria-expanded={infoOpen}
          onClick={() => { setInfoOpen(open => !open) }}
        >
          {infoOpen ? t('tool.image.hideInfo') : t('tool.image.showInfo')}
        </button>
      </div>
      {infoOpen && model.output !== null && <pre className={css.info} data-read-image-info>{model.output}</pre>}
    </section>
  )
}

/** Register the read-image row into the Tool-owned keyed view slot. */
export const readImageToolview = {
  name: 'read-image-toolview',
  inject: ['slots'],
  /**
   * Register after the Tool view's declaration exists; disposal follows the
   * registering Context effect.
   * @param ctx - registrant Context.
   */
  apply(ctx: Context): void {
    ctx.slots.inject('tool.call.toolview', () =>
      ctx.slots.register({ name: 'tool.call.toolview', key: 'read_image', locale: NS }, ReadImageRow))
  },
}
