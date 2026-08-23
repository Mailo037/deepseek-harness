# Agent Note: Raise the Win32 directory-picker dialog above the browser

Status: implemented

English | [中文](2026-08-22-win32-directory-picker-dialog-foreground.zh.md)

## Problem

Clicking "Add workspace" in the Web GUI appeared to do nothing on Windows: no chooser, no taskbar entry, no error. The RPC chain worked end to end and the driver spawned the koffi worker, but two native outcomes produced the same pending UI: `IFileOpenDialog::Show` could create a dialog behind the maximized browser without a taskbar entry, or it could block without creating a common-dialog window at all. Windows grants foreground rights to the process the user last interacted with, while a pick trigger arrives over RPC at a background server process. The worker's `showing` notice precedes `Show`, so it proves only that the COM call is about to begin, not that a window exists.

## Decision

The driver answers the `showing` notice with a bounded, sequential raise service (`raiseThreadWindows` beside the existing abort lever `closeThreadWindows`). It retries until the visible `#32770` common dialog was lifted or every probe reports that no such window exists. Both services declare anonymous Koffi callback prototypes because Koffi rejects redeclaring a named type on their second attempt. `IFileOpenDialog` creates tool and non-tool helper windows before its real dialog; the raiser identifies the common-dialog class and ignores every helper so a tooltip, auto-suggest popup, or other transient window cannot end the retry early. The successful attempt pins the dialog `HWND_TOPMOST` for its whole lifetime and adds `WS_EX_APPWINDOW`, giving the ownerless dialog a taskbar button; an `AttachThreadInput` + `SetForegroundWindow` pass then tries to give it keyboard focus. If every probe completes successfully without finding the common dialog, the driver terminates the blocked worker, waits for its exit, and retries the complete COM conversation once. A second missing window rejects the pick. A probe failure remains best-effort: the driver cannot distinguish an inspection failure from an existing dialog and therefore neither terminates nor retries that worker. The real raise runs only on win32 through the lazily loaded koffi bindings; the driver test lane injects fakes for both levers.

## Alternatives considered

**Give `Show` an owner window from the browser or server process.** Rejected: neither process owns a window on the dialog's thread, and cross-process owners are unsupported territory for the common dialog.

**Do the raise inside the worker before `Show`.** Rejected: the dialog window does not exist until `Show` creates it, and the worker blocks inside that call, so the worker has no point where the window is both alive and reachable.

**Simulate an Alt keypress to bypass the foreground lock.** Rejected: it manipulates global keyboard state to win focus the topmost toggle already delivers without any rights.

**Fall back to the browse backend when activation fails.** Rejected: activation is not a capability failure — the OS chooser works; only its z-order was wrong. A composition-level fallback would punish every host for one cosmetic refusal.

**Retry indefinitely while no common-dialog window exists.** Rejected: a persistent shell or COM failure would create an unbounded process loop. One fresh worker recovers a transient failed conversation; the second absence becomes an explicit failure.

## Consequences

A pick pins the chooser above every non-topmost window and shows a taskbar entry for it regardless of which process holds foreground. Helper windows remain untouched and do not stop the bounded probe. A missing common-dialog window costs one bounded probe plus one automatic retry; two missing windows reject instead of leaving the caller pending. The pin stays for the dialog's whole lifetime; the pick's settle path closes the window. The focus pass remains subject to the foreground lock: on some hosts the dialog appears pinned without keyboard focus, and the user's first click goes to focusing it. Driver tests cover recovery and repeated absence, the win32 real-dialog smoke test exercises the real raiser, and binding tests reject tool and non-tool helpers as a successful raise and exercise repeated callbacks in one process.
