# Agent Note: Read-image tool preview keeps the inspected image visible

Status: implemented

English | [中文](2026-08-30-read-image-tool-preview.zh.md)

## Problem

`read_image` logs a durable image block beside its model-facing text envelope, but its Web tool row used the generic text presentation. The previewed file disappeared behind the path, dimensions, media type, byte count, and serialized attachment reference, even though the inspected image is the result a reader needs first.

## Decision

`ToolCallTree` passes the conversation image renderer into every keyed tool-view owner. The keyed `read_image` row uses that renderer for the durable image it finds in a successful settled result and requests the existing fixed 64px square thumbnail. Selecting the thumbnail continues to open the attachment package's original-image lightbox.

The row keeps the model-facing result envelope intact behind an Info button. A running, failed, or malformed result without an image remains a standard read row, including its existing output and error presentation. No session event, tool schema, or render-intent type changes: the row reads the durable block already present in its frozen result slice.

## Alternatives considered

**Make every historical one-image gallery square.** Rejected: a message image benefits from its natural bounded aspect ratio, while this tool result is a compact action receipt. The owner can therefore request the existing tile variant without changing ordinary message rendering.

**Add an image arm to `ToolResultView`.** Rejected: the durable image block already contains the necessary attachment reference, and a second projection would duplicate it across the tool, Host bridge, runtime, and UI.

## Consequences

Successful image reads lead with the inspected image and keep technical data available on demand. The tool UI remains decoupled from attachment loading: it uses the conversation-owned renderer rather than importing an attachment implementation or resolving session data itself.

## Testing

`read-image-row.client.spec.tsx` pins square-thumbnail delegation, the closed-by-default Info disclosure, and the non-image fallback row. `message-image.client.spec.tsx` pins the forced tile variant for a lone image.
