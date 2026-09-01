# @deepseek-ai/dsh-client-ui-notifications

English | [中文](README.zh.md)

Notification-sound plugin: the General-settings opt-in row, four built-in Web Audio sounds, and a session-state watcher that plays them on the same summary transitions the sidebar status dots project. The Host half registers the durable `ui-notifications` settings namespace; without a settings provider the preference stays process-local (memory mode).

The watcher subscribes to the shared sessions list snapshot store and derives at most one event per session per flush: `error` when `attention` first appears on a row, `attention` when `pendingInteraction` first appears, and `done` when a run stops or the session's first background job completes while nothing else needs handling. Priority in one flush is error > attention > done, so one sound names the most urgent dot state. Subagent-origin rows stay silent — their lifecycle surfaces through the parent's background activity. Transitions derive only against the previously observed snapshot: boot and reconnect re-pulls seed the baseline and never replay existing states.

Sounds are synthesized (oscillator + gain envelopes), so no audio assets ship with the bundle. A suspended `AudioContext` resumes on play; denied resume or missing WebAudio support stays silent instead of throwing.

## Model Experience

None, as the feature reads client-side list summaries and writes one Host user-settings section without adding anything to a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **Sound events cover top-level session rows only** — per-background-job granularity beyond "first completed job" and subagent-child completion sounds are deferred until a consumer needs them.
- **No desktop notifications** — the surface is sound-only; browser Notification-permission plumbing is deferred.
