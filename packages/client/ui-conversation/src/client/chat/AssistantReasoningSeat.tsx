/** Node-local reasoning projection retained inside a work run when prose starts. */
import { memo } from 'react'
import type { ChatNode } from '../contract/chat-nodes.ts'
import type { ChatViewSlotProps } from '../contract/slots.ts'
import { ReasoningRow } from './ReasoningRow.tsx'
import css from './ChatView.module.css'

/**
 * Render an Assistant's reasoning independently of its answer content.
 * @param props - node identity, framework session hook, and conversation locale.
 * @returns reasoning disclosures subscribed only to this Assistant node.
 */
export const AssistantReasoningSeat = memo(function AssistantReasoningSeat({ nodeKey, useSession, t }: {
  nodeKey: string
  useSession: ChatViewSlotProps['useSession']
  t: ChatViewSlotProps['t']
}) {
  const node = useSession(snapshot => snapshot.chat.nodes.get(nodeKey)) as ChatNode<'assistant-step'> | undefined
  if (node === undefined) return null
  return (
    <div className={css.flowItem} data-chat-anchor-key={`${nodeKey}:reasoning`}>
      {node.data.blocks.map((block, index) => block.kind === 'reasoning'
        ? (
          <ReasoningRow
            key={index}
            text={block.text}
            running={node.data.status === 'running' && index === node.data.blocks.length - 1}
            t={t}
          />
        )
        : null)}
    </div>
  )
})
