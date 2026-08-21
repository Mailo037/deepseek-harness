# @deepseek-ai/dsh-client-ui-shell-command

English | [中文](README.zh.md)

Web client half of the `!` shell-command feature: the adjudication-only `!` input-trigger source, the durable `shell-command` Conversation Node, and its terminal-card renderer. Pairs with the host [`@deepseek-ai/dsh-shell-command`](../../shell/shell-command/README.md) service.

## Client contract

`apply` registers three effect-owned contributions:

1. An [`InputTriggerSource`](../../ui-input-trigger/README.md) bound to the `!` trigger named `shell`. The trigger detector never opens a menu for `!`; enter-time adjudication polls the source because the line starts with the trigger. A non-empty `!` line is consumed through the scoped `slash/input-consume-token` bare-token guard (the composer draft clears) and dispatched to the host `shellCommand.run` RPC. A bare `!` falls through to the default sink as an ordinary message; a line carrying image attachments is refused with a notice, keeping draft and images in place.
2. A `ConversationNodeDefinition` of kind `shell-command` folding the `shell/run`/`shell/done` lifecycle into one chat node.
3. The keyed `conversation.chat.node` renderer `ShellCommandCard`, which renders the folded lifecycle as a `TerminalBlock` — run-state dot, cwd, ANSI-colored output, and the exit-status pill.

Only a transport/admission failure surfaces as a composer notice; the durable events own the card presentation, so a failed command still commits the composer draft.

## Composition

The shipped `dsh web` bundle mounts this plugin; it requires the host `shell-command` row (and through it a composed `ctx.shell` executor) and the `ui-input-trigger`/`ui-conversation` client plugins. Disposal of the contributing fiber removes all three contributions.

## Model Experience

### Direct human shell commands

#### What the model sees

Nothing. `!` lines are intercepted by the input-trigger source and executed in the shell command plane; neither the command text nor its output is submitted as a user message or otherwise reaches a model request. The `shell/run`/`shell/done` events are log-only and never surface to the model.

#### Token effect

Command execution and UI output add no model tokens.

#### KV Cache effect

The command line and its output never enter a model request and do not affect its cache.

## Known Limitations and Deferred Work

- **One-shot foreground execution only** — each `!` line runs in a fresh process; state (cwd, variables, functions) does not persist between commands, and `!` lines cannot start background jobs.
- **No streaming** — output is captured and shown when the command settles; long-running commands appear as running until then.
