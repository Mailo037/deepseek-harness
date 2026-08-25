# Agent Note: Composer voice input over the browser speech API

Status: implemented

English | [中文](2026-08-24-voice-input-composer-mic.zh.md)

## Problem

The composer accepts text, files, and references, but no spoken input: a user dictating a message has to switch to another tool and paste. A voice mode should record the microphone, transcribe, and land the text in the composer draft.

## Decision

`@deepseek-ai/dsh-client-ui-voice-input` registers the composer's named `conversation.input.voice` seat — one icon-only mic button (no outline, no background) rendered by InputBar between the context meter and the send button. Clicking starts the browser's SpeechRecognition API (on Windows/Edge that is the OS speech platform), clicking again stops; with `continuous` + `interimResults` enabled, each result event rewrites the draft as the pre-recording base draft plus the cumulative final transcript joined with single spaces, so the user sees the transcription grow and can edit or send it as ordinary draft text. An error restores the base draft and announces through the button label; `aborted` (the user's own stop) stays silent. The seat renders nothing when the browser exposes no recognizer, is disabled while the composer is locked or the input machine is busy, and aborts an active recognizer when a lock arrives or the component unmounts. The button never steals the textarea's focus.

The seat is a browser-only surface: no Host request, no Session event, no projection, and no model-visible input beyond the draft text the user sends. The `voice` locale namespace carries the button and error copy (zh/en, zh as the key-set source of truth).

## Alternatives considered

**Reuse the `conversation.input.right` list slot.** Entries there render left of the model select, and the request places the mic between the model select and the send button (the context meter sits left of it); the named-seat pattern (plan, model) already exists for exactly this kind of composer tool-row control, so a third named seat follows the established shape with one owner.

**Send the transcript through a Host/agent path instead of the draft.** The draft is the composer's own write path (`inputActions.setDraft`), keeps undo and occurrence semantics, and lets the user review before sending; a direct send would skip that review and add a second submission surface.

**A package-private engine or an OS-native bridge.** The browser's SpeechRecognition is the platform default (Windows transcription on Edge), needs no backend, no credentials, and no native code; anything else would own engine configuration, network, and model-selection policy this feature does not need yet.

## Consequences

The composer gains one frameless toggle control; the seat is empty (renders nothing) on browsers without the API, so the layout is unchanged there. Recording owns the draft tail: typing while recording is overwritten by the next result event, and the base draft is captured at start so errors roll back exactly to it. Recognition quality, language coverage, and network behavior follow the browser engine — documented in the package README's Known Limitations. The seat declaration lives in ui-conversation's composer-bar contract (`ComposerBarProps` renders it), the component test drives a fake recognizer through the full start/stream/stop/error/lock/unmount matrix, and the browser-plugin spec proves registration and disposal (HMR safety).
