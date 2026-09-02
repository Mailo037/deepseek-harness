/**
 * Global keyboard shortcuts plugin, browser half: one document-level keydown
 * listener dispatching fixed chords to client services. This plugin renders
 * nothing and owns no store; it wires the product chords — toggle the sidebar
 * (Ctrl/Cmd+B), start a New Session (Ctrl/Cmd+Shift+S), open the details
 * panel (Ctrl/Cmd+.), and focus the composer (Ctrl/Cmd+Shift+F) — to the same
 * layout, workspace, and conversation surfaces the buttons use, so the
 * keyboard path is exactly as authoritative as the controls. `Ctrl+N` cannot
 * serve New Session: browsers reserve it for a new window and never deliver
 * it to the page, so the chord uses Shift+S (S = Session) instead.
 */
import type { ClientContext, IWorkspaces } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the ui-layout Context merge (ctx.layout) and its face.
import type { ILayout } from '@deepseek-ai/dsh-client-ui-layout/client'

/** Toggle the sidebar column (open ⟷ collapsed). */
export const SIDEBAR_KEY = 'b'
/** Start a New Session (browsers reserve Ctrl+N for a new window). */
export const NEW_SESSION_KEY = 's'
/** Open the details panel (the right-hand tool/details column). */
export const DETAILS_KEY = '.'
/** Focus the composer input (the first editable textarea in the document). */
export const FOCUS_COMPOSER_KEY = 'f'

/** Whether the chord's primary modifier is held (Cmd on Mac, Ctrl elsewhere). */
function accelerated(event: KeyboardEvent): boolean {
  return event.metaKey || event.ctrlKey
}

/**
 * Match one chord exactly: the primary modifier, no Alt, and the shift
 * requirement per chord. Exactness keeps unrelated chords (Ctrl+Shift+B in
 * Firefox, Ctrl+S save-as) out of this plugin's hands.
 */
function isChord(event: KeyboardEvent, key: string, shift: boolean): boolean {
  return accelerated(event)
    && !event.altKey
    && event.shiftKey === shift
    && event.key.toLowerCase() === key
}

/**
 * Focus the first editable textarea in the document — the composer in the
 * ordinary layout. A dialog's textarea, when one is open, is the first
 * editable one and wins instead; that is acceptable, since focusing the
 * active input is what the gesture asks for.
 */
function focusComposer(): void {
  const editable = document.querySelector<HTMLTextAreaElement>('textarea:not([readonly])')
  editable?.focus()
}

/**
 * Dispatch one keydown to the shortcut actions. Repeats and IME composition
 * never fire (hold-to-repeat would flip the sidebar rapidly; a composing
 * chord is input text, not a command), and an already-handled event is left
 * alone so component-level handlers keep priority.
 * @param event - the document keydown event.
 * @param layout - the layout panel-action face.
 * @param workspaces - the workspace/session-action face.
 */
function dispatch(event: KeyboardEvent, layout: ILayout, workspaces: IWorkspaces): void {
  // oxlint-disable-next-line typescript/no-deprecated -- legacy IMEs expose composition only through keyCode 229
  if (event.defaultPrevented || event.repeat || event.isComposing || event.keyCode === 229) return
  if (isChord(event, SIDEBAR_KEY, false)) {
    event.preventDefault()
    layout.toggleSidebar()
    return
  }
  if (isChord(event, NEW_SESSION_KEY, true)) {
    event.preventDefault()
    workspaces.startSession()
    return
  }
  if (isChord(event, DETAILS_KEY, false)) {
    event.preventDefault()
    layout.openDetails()
    return
  }
  if (isChord(event, FOCUS_COMPOSER_KEY, true)) {
    event.preventDefault()
    focusComposer()
  }
}

/** Required services: the cross-plugin panel-action face and the workspace/session actions. */
export const inject = ['layout', 'workspaces']

/**
 * Client plugin body: bind the document keydown listener for the plugin
 * fiber's lifetime.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      dispatch(event, ctx.layout, ctx.workspaces)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => { document.removeEventListener('keydown', onKeyDown) }
  }, 'ui-shortcuts: document keydown listener')
}
