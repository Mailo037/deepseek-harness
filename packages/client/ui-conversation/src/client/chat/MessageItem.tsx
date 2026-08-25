// MessageItem: simple chat nodes — user and consumed-steering bubbles
// (right-aligned, with clock + copy IconActions; branch lives only under
// assistant answers), pending steering (copy only), context injection,
// compaction marker, retry disclosure, turn-error retry/copy actions, and
// unknown-surface JSON rows.

import { memo, useLayoutEffect, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type {
  ModelRetryNode, TurnErrorNode, UserMessageNode,
} from '@deepseek-ai/dsh-client-runtime/client'
import { JsonBlock, MessageText, StateDot, FileTypeIcon, fileTypeIconKind } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ChatNodeOwnerProps, ChatNodeViewProps, ChatViewSlotProps } from '../contract/slots.ts'
import { ReferenceIcon } from '../reference/ReferenceIcon.tsx'
import { CompactionItem } from './CompactionItem.tsx'
import { ContextInjectionRow } from './ContextInjectionRow.tsx'
import { MessageIconActions } from './MessageIconActions.tsx'
import css from './MessageItem.module.css'

type UserImage = Extract<UserMessageNode['content'][number], { type: 'image' }>

function contentParts(content: readonly unknown[]): {
  text: string
  images: { attachment: UserImage['attachment'] }[]
  rest: unknown[]
} {
  const texts: string[] = []
  const images: { attachment: UserImage['attachment'] }[] = []
  const rest: unknown[] = []
  for (const block of content) {
    const b = block as { type?: string; text?: string; attachment?: unknown }
    if (b.type === 'text' && typeof b.text === 'string') texts.push(b.text)
    else if (b.type === 'image' && b.attachment !== undefined) {
      images.push({ attachment: (b as UserImage).attachment })
    }
    else rest.push(block)
  }
  return { text: texts.join(''), images, rest }
}

function retrySeconds(milliseconds: number): number {
  return Math.max(1, Math.ceil(milliseconds / 1_000))
}

/** Body height above which a user bubble clamps behind a show-more disclosure. */
const USER_BUBBLE_COLLAPSE_HEIGHT = 264
/** Clamped body height: whole 24px lines under the fade gradient. */
const USER_BUBBLE_CLAMPED_HEIGHT = 240

/**
 * Show-more disclosure for an over-tall user bubble: the body clamps at a
 * fixed max-height with a fade into the bubble fill, and one toggle expands
 * it in place. Measurement is layout-synchronized, so an over-tall message
 * never paints unclamped for a frame; `measureKey` re-runs it when the
 * content changes (streaming pending steering grows).
 */
function ClampableBubbleBody({ measureKey, children, t }: {
  /** Re-measurement key: the rendered content's source array. */
  measureKey: readonly unknown[]
  children: ReactNode
  t: ChatViewSlotProps['t']
}) {
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const [clamped, setClamped] = useState(false)
  const [expanded, setExpanded] = useState(false)
  useLayoutEffect(() => {
    const el = bodyRef.current
    /* v8 ignore next -- the ref is always attached by effect time: the div renders unconditionally. */
    if (el === null) return
    setClamped(el.scrollHeight > USER_BUBBLE_COLLAPSE_HEIGHT)
  }, [measureKey])
  return (
    <>
      <div
        ref={bodyRef}
        className={css.bubbleBody}
        data-clamped={clamped && !expanded || undefined}
        style={clamped && !expanded ? { maxHeight: USER_BUBBLE_CLAMPED_HEIGHT } : undefined}
      >
        {children}
      </div>
      {clamped && (
        <button
          type="button"
          className={css.bubbleToggle}
          aria-expanded={expanded}
          onClick={() => { setExpanded(e => !e) }}
        >
          {expanded ? t('message.showLess') : t('message.showMore')}
        </button>
      )}
    </>
  )
}

interface RetryCountdown {
  deadline: number
  seconds: number
}

function ModelRetryItem({ node, active, t }: {
  node: ModelRetryNode
  active: boolean
  t: ChatViewSlotProps['t']
}) {
  // Anchor the host-scheduled delay to this browser's first render of the
  // retry node. Host event time and Date.now() may belong to different clocks.
  const deadline = useMemo(() => Date.now() + node.delayMs, [node.delayMs, node.seq])
  const scheduledSeconds = retrySeconds(node.delayMs)
  const maximum = node.mode === 'normal' ? node.maxRetries : '∞'
  const [countdown, setCountdown] = useState<RetryCountdown>(() => ({
    deadline,
    seconds: retrySeconds(deadline - Date.now()),
  }))
  const remainingSeconds = countdown.deadline === deadline
    ? countdown.seconds
    : retrySeconds(deadline - Date.now())

  useEffect(() => {
    if (!active) return
    const updateCountdown = (): number => {
      const next = retrySeconds(deadline - Date.now())
      setCountdown(current => (
        current.deadline === deadline && current.seconds === next
          ? current
          : { deadline, seconds: next }
      ))
      return next
    }
    if (updateCountdown() === 1) return
    const timer = window.setInterval(() => {
      if (updateCountdown() === 1) window.clearInterval(timer)
    }, 250)
    return () => { window.clearInterval(timer) }
  }, [active, deadline])

  const label = active
    ? t('message.retry.active')
    : node.retryState === 'cancelled'
      ? t('message.retry.cancelled')
      : node.retryState === 'started'
        ? t('message.retry.started')
        : t('message.retry.scheduled')
  const seconds = active ? remainingSeconds : scheduledSeconds

  return (
    <details className={css.retryRow} data-active={active || undefined}>
      <summary className={css.retrySummary}>
        <span className={css.retryText} role="status">
          {t('message.retry.status', { label, retry: node.retry, maximum, seconds })}
        </span>
      </summary>
      <div className={css.retryDetails}>
        <div>
          <span className={css.retryDetailLabel}>{t('message.retry.delay')}</span>
          {Math.round(node.delayMs)}ms
        </div>
        <div>
          <span className={css.retryDetailLabel}>{t('message.retry.failure')}</span>
          {node.failure.message}
        </div>
      </div>
    </details>
  )
}

function formatTurnErrorCopyText(node: TurnErrorNode): string {
  const parts: string[] = []
  if (node.code !== undefined && !node.message.startsWith(node.code)) {
    parts.push(`${node.code}: ${node.message}`)
  } else {
    parts.push(node.message)
  }
  if (node.status !== undefined) {
    parts.push(`(HTTP ${node.status})`)
  }
  if (node.requestId !== undefined) {
    parts.push(`[Request ID: ${node.requestId}]`)
  }
  return parts.join(' ')
}

/** Persistent, turn-positioned feedback for a terminal failure. */
function TurnErrorItem({ node, onRetry, t }: {
  node: TurnErrorNode
  /** Send the continue prompt into the session as the immediate next turn. */
  onRetry: () => void
  t: ChatViewSlotProps['t']
}) {
  const [detailsOpen, setDetailsOpen] = useState(false)
  const copyText = useMemo(() => formatTurnErrorCopyText(node), [node])

  return (
    <div className={css.turnErrorBlock}>
      <div className={css.turnErrorRow} role="status">
        <StateDot state="error" className={css.turnErrorDot} />
        <div className={css.turnErrorCopy}>
          <span className={css.turnErrorTitle}>{t('message.turnError')}</span>
          <span className={css.turnErrorMessage}>{node.message}</span>
        </div>
        {node.code !== undefined && <code className={css.turnErrorCode}>{node.code}</code>}
      </div>
      <div className={css.turnErrorActions}>
        <button type="button" className={css.turnErrorRetry} onClick={onRetry}>
          {t('message.turnError.retry')}
        </button>
        <button
          type="button"
          className={css.turnErrorDetailsBtn}
          aria-expanded={detailsOpen}
          onClick={() => { setDetailsOpen(open => !open) }}
        >
          {detailsOpen ? t('message.turnError.hideDetails') : t('message.turnError.details')}
        </button>
        <MessageIconActions text={copyText} clock="end" className={css.turnErrorCopyAction} t={t} />
      </div>
      {detailsOpen && (
        <div className={css.turnErrorDetailsPanel}>
          {node.code !== undefined && (
            <div className={css.turnErrorDetailRow}>
              <span className={css.turnErrorDetailLabel}>{t('message.turnError.detail.code')}</span>
              <code className={css.turnErrorDetailValue}>{node.code}</code>
            </div>
          )}
          {node.status !== undefined && (
            <div className={css.turnErrorDetailRow}>
              <span className={css.turnErrorDetailLabel}>{t('message.turnError.detail.status')}</span>
              <span className={css.turnErrorDetailValue}>{node.status}</span>
            </div>
          )}
          {node.requestId !== undefined && (
            <div className={css.turnErrorDetailRow}>
              <span className={css.turnErrorDetailLabel}>{t('message.turnError.detail.requestId')}</span>
              <span className={css.turnErrorDetailValue}>{node.requestId}</span>
            </div>
          )}
          <div className={css.turnErrorDetailRow}>
            <span className={css.turnErrorDetailLabel}>{t('message.turnError.detail.message')}</span>
            <span className={css.turnErrorDetailValue}>{node.message}</span>
          </div>
        </div>
      )}
    </div>
  )
}

/** Persistent, turn-positioned notice for a turn ended at the output-token cap. */
function TurnMaxTokensItem({ t }: {
  t: ChatViewSlotProps['t']
}) {
  return (
    <div className={css.turnErrorRow} role="status">
      <StateDot state="warning" className={css.turnErrorDot} />
      <div className={css.turnErrorCopy}>
        <span className={css.maxTokensTitle}>{t('message.maxTokens')}</span>
        <span className={css.turnErrorMessage}>{t('message.maxTokens.hint')}</span>
      </div>
    </div>
  )
}

/**
 * Display projection of reference forms in a user bubble (free geometry — no
 * textarea alignment constraint here); everything else stays plain text. The
 * logged model text remains the single truth; this is presentation only.
 * Plain-text `/name` / `@name` word-boundary tokens decorate (the sent text
 * IS the reference — the bubble uses the same plainest token
 * scan as the composer, minus the lexicon: sent tokens were validated at
 * compose time, so shape alone decorates).
 */
function projectUserText(text: string, sessionLabels: readonly string[]): ReactNode {
  const ranges: { start: number; end: number; label: string; kind: 'session' | 'plain' }[] = []
  for (const rawLabel of [...new Set(sessionLabels)].sort((a, b) => b.length - a.length)) {
    const label = `@${rawLabel}`
    let start = text.indexOf(label)
    while (start >= 0) {
      ranges.push({ start, end: start + label.length, label, kind: 'session' })
      start = text.indexOf(label, start + label.length)
    }
  }
  const re = /(^|\s)(\/[\w-]+|@"[^"\n]+"|@[^\s]+)/gu
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const tokenStart = m.index + (m[1]?.length ?? 0)
    const rawLabel = m[2] ?? ''
    const label = rawLabel.startsWith('@"')
      ? rawLabel
      : rawLabel.replace(/[.,;:!?，。；：！？]+$/gu, '')
    if (label.length <= 1) continue
    ranges.push({ start: tokenStart, end: tokenStart + label.length, label, kind: 'plain' })
  }
  ranges.sort((a, b) => a.start - b.start
    || (a.kind === b.kind ? b.end - a.end : a.kind === 'session' ? -1 : 1))
  const parts: ReactNode[] = []
  let cursor = 0
  for (const range of ranges) {
    if (range.start < cursor) continue
    const { start: tokenStart, end, label, kind } = range
    if (tokenStart > cursor) parts.push(<MessageText key={cursor} text={text.slice(cursor, tokenStart)} />)
    const referenceKind = kind === 'session'
      ? 'session'
      : label.startsWith('@')
        ? label.endsWith('/') ? 'folder' : 'file'
        : undefined
    const displayLabel = referenceKind === undefined
      ? label
      : referenceKind === 'session'
        ? label.slice(1)
        : label.slice(1).replace(/^"|"$/gu, '').split(/[\\/]/u).filter(Boolean).at(-1) ?? label.slice(1)
    parts.push(
      <span
        key={tokenStart}
        className={css.refChip}
        data-ref-chip={referenceKind ?? 'skill'}
        title={label}
      >
        {referenceKind !== undefined && (
          referenceKind === 'file'
            ? <FileTypeIcon kind={fileTypeIconKind(label)} size={16} className={css.refIcon} />
            : <ReferenceIcon kind={referenceKind} size={16} className={css.refIcon} />
        )}
        {displayLabel}
      </span>,
    )
    cursor = end
  }
  if (parts.length === 0) return <MessageText text={text} />
  if (cursor < text.length) parts.push(<MessageText key={cursor} text={text.slice(cursor)} />)
  return <>{parts}</>
}

/** Right-aligned bubble shared by user and steering rows. */
function UserStyleBubble({
  content, renderMessageImages, actions, pending = false, referenceLabels = [], t,
}: {
  content: readonly unknown[]
  renderMessageImages: ChatNodeOwnerProps['renderMessageImages']
  /** Optional IconActions (or similar) below the bubble; receives the joined text. */
  actions?: (text: string) => ReactNode
  /** Whether this is the Host-authoritative pre-admission steering projection. */
  pending?: boolean
  /** Exact session mention labels associated by the adjacent recall node. */
  referenceLabels?: readonly string[]
  t: ChatViewSlotProps['t']
}): ReactNode {
  const { text, images, rest } = contentParts(content)
  const truncated = (total: number): string => t('json.truncated', { total })
  const showBubble = text !== '' || rest.length > 0
  return (
    <div className={css.userRow} data-pending-steering={pending || undefined} data-time-hover-root>
      <div className={css.userStack}>
        {renderMessageImages({ images, align: 'end' })}
        {showBubble && <div className={css.bubble}>
          <ClampableBubbleBody measureKey={content} t={t}>
            {projectUserText(text, referenceLabels)}
            {rest.map((block, i) => <JsonBlock key={i} label={t('message.extraBlock')} payload={block} truncatedLabel={truncated} />)}
          </ClampableBubbleBody>
        </div>}
        {referenceLabels.length > 0 && (
          <div className={css.referenceSummary}>
            {t('message.referenceSummary', { labels: referenceLabels.join(t('message.referenceSeparator')) })}
          </div>
        )}
      </div>
      {actions?.(text)}
    </div>
  )
}

/**
 * Render one Host-authoritative pending steering item with the same visual
 * language as its eventual durable transcript node.
 * @param props - Pending message content and conversation translator.
 * @returns the pending steering bubble.
 */
export function PendingSteeringBubble({ content, renderMessageImages, t }: {
  content: readonly unknown[]
  renderMessageImages: ChatNodeOwnerProps['renderMessageImages']
  t: ChatViewSlotProps['t']
}): ReactNode {
  return (
    <UserStyleBubble
      content={content}
      renderMessageImages={renderMessageImages}
      pending
      t={t}
      actions={text => (
        <MessageIconActions
          text={text}
          clock="start"
          className={css.actions}
          t={t}
        />
      )}
    />
  )
}

/** User and admitted-steering keyed Chat renderer. */
export const UserMessageNodeView = memo(function UserMessageNodeView({
  node, renderMessageImages, t,
}: ChatNodeViewProps<'user' | 'steering'>) {
  const data = node.data
  return (
    <UserStyleBubble
      content={data.content}
      renderMessageImages={renderMessageImages}
      {...data.referenceLabels === undefined ? {} : { referenceLabels: data.referenceLabels }}
      t={t}
      actions={text => (
        <MessageIconActions
          text={text}
          time={data.time}
          clock="start"
          className={css.actions}
          t={t}
        />
      )}
    />
  )
})

/** Injected-context keyed Chat renderer. */
export const ContextMessageNodeView = memo(function ContextMessageNodeView({ node, t }: ChatNodeViewProps<'context'>) {
  const data = node.data
  return (
    <ContextInjectionRow
      content={data.content}
      source={data.source}
      provenance={data.provenance}
      form={data.form}
      t={t}
    />
  )
})

/** Automatic compaction keyed Chat renderer. */
export const CompactionNodeView = memo(function CompactionNodeView({ node, t }: ChatNodeViewProps<'compaction'>) {
  return <CompactionItem node={node.data} t={t} />
})

/** Correlated retry-chain keyed Chat renderer. */
export const RetryNodeView = memo(function RetryNodeView({ node, t }: ChatNodeViewProps<'model-retry'>) {
  const data = node.data
  return <ModelRetryItem node={data.current} active={data.current.retryState === 'scheduled'} t={t} />
})

/** Terminal turn-error keyed Chat renderer. */
export const TurnErrorNodeView = memo(function TurnErrorNodeView({
  node, sendMessage, t,
}: ChatNodeViewProps<'turn-error'>) {
  return (
    <TurnErrorItem
      node={node.data}
      onRetry={() => { sendMessage(t('message.turnError.retryMessage')) }}
      t={t}
    />
  )
})

/** Max-tokens turn-end notice keyed Chat renderer. */
export const TurnMaxTokensNodeView = memo(function TurnMaxTokensNodeView({ t }: ChatNodeViewProps<'turn-max-tokens'>) {
  return <TurnMaxTokensItem t={t} />
})

/** Explicit unknown-surface keyed Chat renderer. */
export const UnknownNodeView = memo(function UnknownNodeView({ node, t }: ChatNodeViewProps<'unknown'>) {
  const data = node.data
  return (
    <div className={css.contextRow}>
      <JsonBlock
        label={t('message.unknownSurface', { type: data.type })}
        payload={data.data}
        truncatedLabel={total => t('json.truncated', { total })}
      />
    </div>
  )
})
