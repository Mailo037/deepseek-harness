/**
 * Full-screen connecting state shown while pairing. It communicates progress
 * as three concrete steps (find the PC → secure channel → device setup),
 * names the endpoint currently being contacted, and offers a cancel — the
 * opposite of a static "Connecting…" text, which leaves the user uncertain
 * whether the app is still working during long multi-endpoint attempts.
 */

import type { ReactNode } from 'react'
import { CheckIcon, LogoMark, MonitorIcon, PhoneIcon } from './components/Brand.tsx'
import type { PairingStage } from './PairingService.ts'

interface ConnectingScreenProps {
  stage: PairingStage
  onCancel: () => void
}

const STEP_TITLES = ['Searching for the PC', 'Establishing secure channel', 'Saving connection'] as const

/** Detail line shown under the currently active step. */
function stageDetail(stage: PairingStage): string {
  switch (stage.kind) {
    case 'finding':
      return `Contacting ${stage.serverUrl}`
    case 'handshake':
      return `Secure channel to ${stage.serverUrl}`
    case 'setup':
      return 'Saving device credentials'
  }
}

export function ConnectingScreen({ stage, onCancel }: ConnectingScreenProps): ReactNode {
  const current = stage.kind === 'finding' ? 0 : stage.kind === 'handshake' ? 1 : 2
  const pcReached = current >= 1
  return (
    <div className="screen screen-enter">
      <LogoMark size={36} />
      <h1 className="title">Connecting to your PC</h1>
      <div
        className="link-visual"
        data-stage={stage.kind}
        role="img"
        aria-label={stage.kind === 'finding' ? 'Searching for the PC' : 'Connecting to the PC'}
      >
        <div className={`link-node link-node-left ${pcReached ? 'done' : 'active'}`}>
          <div className="node-circle"><MonitorIcon size={24} /></div>
          <span className="node-label">PC</span>
        </div>
        <div className="link-beam">
          <span className="link-packet" />
          <span className="link-packet" />
          <span className="link-packet" />
        </div>
        <div className={`link-node link-node-right ${pcReached ? 'active' : ''}`}>
          <div className="node-circle"><PhoneIcon size={24} /></div>
          <span className="node-label">Phone</span>
        </div>
      </div>
      <div className="steps">
        {STEP_TITLES.map((title, index) => {
          const state = index < current ? 'done' : index === current ? 'current' : 'pending'
          const className = `${state === 'done' ? 'done' : ''} ${state === 'current' ? 'current' : ''}`
          return (
            <div key={title} className={`step ${className.trim()}`}>
              <div className="step-marker">{state === 'done' ? <CheckIcon size={12} /> : null}</div>
              <div className="step-text">
                <div className="step-title">{title}</div>
                {state === 'current' && <div className="step-detail mono">{stageDetail(stage)}</div>}
              </div>
            </div>
          )
        })}
      </div>
      <button className="button ghost" onClick={onCancel}>Cancel</button>
    </div>
  )
}
