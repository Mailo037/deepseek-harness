# @deepseek-ai/dsh-client-ui-launch

English | [中文](README.zh.md)

Launch-at-computer-start plugin: the General-settings switch that registers or removes the app's login item. The Host half owns the durable `ui-launch` settings namespace and applies committed values through the surface-provided `launchSettings` backend; the browser half binds the namespace and registers the preference row. The backend seam is application-owned: the web bundle's `web-launch-item` row registers a Windows per-user registry Run-key backend relaunching the checkout's web host, the Electron main registers its login-item surface, and a macOS or Linux web host composes none — there the Host half's injection never fires, the namespace stays unregistered, and the row renders nothing, so a switch that could not act never appears.

The preference is opt-in — nothing registers a launch entry the user never switched on, and an untouched switch never clobbers an OS-managed entry. The Host half waits for the backend service before registering, so the provider's activation order never matters.

## Model Experience

None, as the feature is a browser-side preference row plus a Host settings registration whose login-item application never enters a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **Application is best-effort at the OS boundary** — the backend applies the switch through the platform's launch mechanism (Windows per-user registry Run key, macOS LaunchAgent via Electron login items, Linux XDG autostart); OS policies that remove or ignore such entries are outside this package's control and are not detected.
- **The switch does not verify OS state** — the row reflects the persisted preference, not a read-back of the actual launch entry; a user deleting the entry outside the app shows the switch on until the next change is applied.
- **The web surface's Run key is checkout-bound** — the registered command relaunches `pnpm dsh --profile web --no-open` from the installation root the backend sampled; moving or deleting the checkout orphans the entry until the switch is reapplied.
