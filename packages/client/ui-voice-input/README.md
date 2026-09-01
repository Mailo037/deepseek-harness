# @deepseek-ai/dsh-client-ui-voice-input

English | [中文](README.zh.md)

Voice input plugin, browser half: the composer's named `conversation.input.voice` seat — one icon-only mic button between the model select and the send button (no outline, no background). Clicking starts the browser's SpeechRecognition (on Windows/Edge this is the OS speech platform), clicking again stops; final segments stream into the composer draft while recording, joined with single spaces, so the user can review before sending. The button renders nothing when the browser exposes no recognizer.

A recognizer error restores the pre-recording draft and announces through the button label; `aborted` is the user's own stop and stays silent. The seat is disabled while the composer is locked or the input machine is busy (adjudicating/submitting), and a lock during recording aborts the recognizer. The button never steals the textarea's focus.

The contribution needs nothing beyond the session standard kit (`useInput` / `inputActions`) and the browser API: no Host request, no Session event, no projection — the transcript is plain draft text exactly as if typed.

The `/client` exports are the plugin body (`apply`/`inject`). The recognition language follows `navigator.language` (the browser/OS default — Windows transcription follows the system language), with continuous listening and interim results enabled so final segments commit progressively.

## Model Experience

Indirectly, through the composer draft, transcribed text reaches the model only when the user sends it; the feature adds no prompt content of its own, and nothing is sent while recording.

#### KV Cache effect

None — no prompt content is produced beyond the draft the user sends.

## Known Limitations and Deferred Work

- **Browser-dependent engine** — the Web Speech API's implementation (Windows/Edge uses the OS speech platform; Chrome desktop uses its own service), so recognition quality, language coverage, and network requirements follow the browser, not this package. There is no packaged offline engine and no custom model or language picker.
- **Recording owns the draft tail** — while recording, each result event rewrites the draft as the base draft plus the cumulative transcript; typing during recording is overwritten by the next result. Type after stopping.
- **No auto-send and no push-to-talk hold** — the button is a toggle; transcription never submits itself, and the engine's continuous mode keeps listening until the user stops.
