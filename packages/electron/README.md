# Pichamber Desktop

Electron desktop runtime for Pichamber. **macOS is the product target.** Windows and Linux desktop packaging is leftover upstream work and is not maintained here.

This package owns the native shell: windows, menus, deep links, native notifications, auto-updates, host switching, SSH connections, tunnel helpers, and packaged desktop builds. The in-process Pichamber server lives in `packages/web` and shared React UI lives in `packages/ui`.

## How It Runs

Desktop starts the Pichamber web server in the same Electron main process and boots the **Pi kernel** by default (`OPENCHAMBER_KERNEL=pi`). There is no separate sidecar subprocess for the server, and no managed OpenCode child process on the default path. The HTTP facade stays in Electron. User `{agentDir}/npm` extensions load in a Node child that runs the app-bundled `@earendil-works/pi-coding-agent` plus a resolved or packaged Node — not PATH `pi`, and not `dlopen` of user natives inside Electron.

`main.mjs` imports `@pichamber/web/server/index.js` and calls `startWebUiServer()`. The Electron window then loads the UI from the local server in development, or from packaged `resources/web-dist` assets in packaged builds.

Same-origin session-chat iframes complete an authenticated parent-frame handshake before creating their SDK client. The parent supplies its active in-memory endpoint and credentials; when relay is active it also supplies the public relay descriptor without any pairing grant, because Electron preload and IPC are unavailable inside the iframe. The iframe establishes its own transport and rebinds its SDK before rendering. Additional windows retain their own per-window runtime bootstrap instead of being overwritten by the main window. Credentials are never placed in iframe URLs, and other child pages do not receive this runtime state.

The preload bridge exposes desktop-only APIs to the web UI through `window.__OPENCHAMBER_DESKTOP__`. Privileged commands are checked in `main.mjs`, not only in the UI. Preload also exposes a read-only `__OPENCHAMBER_DESKTOP_BOOT_OUTCOME_SEED__` from the `--openchamber-boot-outcome` window switch so splash can dismiss if the later `dom-ready` inject fails after a remount. The writable `__OPENCHAMBER_DESKTOP_BOOT_OUTCOME__` still comes from the main-process init script so host switches can refresh it.

## Main Files

| File | Purpose |
|------|---------|
| `main.mjs` | Electron main process, app lifecycle, windows, menus, deep links, native IPC handlers, updates, local server startup |
| `startup-url-selection.mjs` | Pure bundled/HMR startup probe and loopback connection-limit policy |
| `preload.mjs` | Safe bridge from the rendered UI to Electron IPC |
| `ssh-manager.mjs` | SSH host import, connection lifecycle, tunnel/port forwarding helpers |
| `scripts/electron-dev.mjs` | Desktop dev launcher with Vite HMR support |
| `scripts/ensure-electron.mjs` | Verifies the installed Electron binary is complete and repairs it via the postinstall under Bun |
| `scripts/build-web-assets.mjs` | Builds `packages/web` and stages UI assets into `resources/web-dist` |
| `scripts/prepare-pi-kernel.mjs` | Verifies the app-bundled Pi SDK (`@earendil-works/pi-coding-agent`) is installed |
| `scripts/prepare-node.mjs` | Stages a Node binary into `resources/node` so packaged Desktop can load user extensions without assuming a system Node |
| `scripts/prepare-opencode-cli.mjs` | Optional leftover: downloads OpenCode CLI only when `OPENCHAMBER_BUNDLE_OPENCODE_CLI=1` or `OPENCHAMBER_KERNEL=opencode` |
| `scripts/bundle-main.mjs` | Bundles Electron main code into `dist-bundle/main.mjs` for packaging |
| `scripts/rebuild-native.mjs` | Rebuilds native modules against the Electron runtime |
| `scripts/package.mjs` | Runs `electron-builder`, with unsigned Windows/Mac builds when signing env is missing |
| `scripts/install-apple-desktop-cert.sh` | CI: import `APPLE_CERTIFICATE` into a keychain and pin `CSC_NAME` (no `CSC_LINK` re-import) |
| `scripts/verify-macos-app-signature.sh` | CI: require Developer ID, hardened runtime, stapled notarization, and Electron JIT entitlements |
| `scripts/generate-product-icons.mjs` | Rasterizes `app-icon.svg` / `tray-glyph.svg` into icns, ico, PNG, tray frames, and web/docs badges |
| `scripts/generate-macos-icon-assets.cjs` | Compiles `AppIcon.icon` to `Assets.car` with Xcode `actool` (macOS only) |
| `resources/` | Packaged web assets, icons, and macOS entitlements |

## Product icons

Desktop identity is generated from SVG masters. Do not hand-edit the raster/icns/ico outputs.

| Source | Role |
|--------|------|
| `resources/icons/app-icon.svg` | Dock mark: open-top cube + official Pi glyph in the old OpenCode O slot (`scale(0.068)`, `ty=-24`). Not `pi.dev/favicon.svg`. |
| `resources/icons/tray/tray-glyph.svg` | Same in-app chamber+glyph, black, no plate. Template-safe tray idle/unseen/breath. |
| `resources/icons/dev-icon.png` | Same desktop mark plus a small amber (`#F5A524`) badge for `electron:dev`. |

```bash
bun run --cwd packages/electron generate:product-icons
bun run --cwd packages/electron generate:macos-icon   # macOS + Xcode, writes Assets.car
```

`generate:product-icons` refuses a raw `pi.dev/favicon.svg` copy and the rejected `scale(0.115)` / `ty=6` inner placement. In-app `OpenChamberLogo` is the same chamber + top-face glyph at `currentColor`.

## Development

From the repo root:

```bash
bun install
bun run electron:dev
```

Run this **on a Mac**. `bun run electron:dev` starts the web dev server with HMR, then launches Electron against `packages/electron/main.mjs` with `OPENCHAMBER_KERNEL=pi`. The window title is Pichamber. Configure models/auth in `~/.pi/agent`.

The Electron workspace package trusts Electron's install script so `bun install` downloads the platform runtime in fresh checkouts and worktrees.

Electron's postinstall (`node install.js`) is run by `bun install` with the system Node. Older Electron releases bundled `extract-zip@2.0.1`, which under Node 24 silently unpacked only the first entry of the Electron zip, leaving `dist/` without the binary and `path.txt` missing. Electron 43+ ships its own fixed extractor (`@electron-internal/extract-zip`), but to keep interrupted or wrong-architecture installs from blocking desktop work:

- The root `postinstall` runs `ensure-electron.mjs --best-effort`, which detects an incomplete Electron install (missing binary, stale `dist/version`/`path.txt`, or a binary of the wrong architecture) and repairs it by re-running the postinstall under Bun (which extracts correctly), falling back to Node.
- `electron-dev.mjs` runs the same check (fail-fast, not best-effort) before launching, so `bun run electron:dev` self-heals even when an install was interrupted.
- The check can be run on demand with `bun run --cwd packages/electron ensure:electron`; set `ELECTRON_SKIP_BINARY_DOWNLOAD=1` to skip repair (e.g. CI without a network).
- Unit tests in `scripts/ensure-electron.test.mjs` (run via `bun run --cwd packages/electron test:architecture`) cover healthy/missing/stale installs, wrong-architecture binaries, repair fallback, and `--best-effort`.

Useful variants:

```bash
bun run electron:dev:bundled
bun run --cwd packages/electron ensure:electron
bun run type-check:electron
bun run lint:electron
```

`electron:dev:bundled` builds and uses packaged web assets instead of the HMR server. Use it when testing behavior closer to a packaged app.

## Packaging

From the repo root:

```bash
bun run electron:build
```

That runs, in order:

1. `build:web-assets` to build the web UI and copy it into `packages/electron/resources/web-dist`.
2. `prepare:pi-kernel` to verify the app-bundled Pi SDK is installed.
3. `prepare:node` to stage a Node binary for the Desktop kernel child.
4. `prepare:opencode-cli` — skipped for the default Pi kernel. Set `OPENCHAMBER_BUNDLE_OPENCODE_CLI=1` to stage the leftover OpenCode CLI.
5. `bundle:main` to create `packages/electron/dist-bundle/main.mjs`.
6. `rebuild:native` to rebuild native modules for Electron.
7. `package.mjs` to run `electron-builder`; its `afterPack` hook stages the compiled macOS icon asset catalog.

GitHub Release, desktop smoke, and the standalone Mac DMG job must call `prepare:node` (the local `package` script already does). After `package.mjs`, run `verify:pi-node-kernel:packaged`. That check requires `Contents/Resources/node/bin/node` (or the Windows `node.exe`) and `app.asar.unpacked/node_modules/@pichamber/web/server/lib/pi/node-kernel-child.js`. It does not require `resources/pi-node-kernel/`. The child script is the asar-unpacked module next to the Pi host, not a copied extraResource.

**Package on a Mac.** A Linux VM cannot produce a usable `Pichamber-*.dmg`. Build output goes to `packages/electron/dist` (`Pichamber-<version>-mac-<arch>.dmg` and `.zip`).

GitHub Release / desktop smoke builds import `APPLE_CERTIFICATE` (Developer ID Application) into a temporary keychain and pin electron-builder with `CSC_NAME` only — they do not pass `CSC_LINK` / `CSC_KEY_PASSWORD`, because electron-builder would re-import the p12 and `GITHUB_ENV` can corrupt that password. They notarize with `APPLE_ID` + `APPLE_PASSWORD` + `APPLE_TEAM_ID`. The signed job fails if the imported identity is not Developer ID Application, or if the `.app` is missing a stapled notary ticket. The first Developer ID notarization for a team can stay `In Progress` for hours or days — `notarytool --wait` will hold CI until Apple finishes or the job hits its timeout. GitHub Release and standalone Mac DMG jobs allow 330 minutes so a first ticket is not cancelled at 120 minutes. After that first ticket lands, later builds are usually faster, but Apple can still take most of an hour.

GitHub Release uploads `latest-mac.yml` as soon as the Apple Silicon job has put its zip/dmg on the Release, so Desktop on arm64 can see the update while Intel is still notarizing. Intel is an optional Release job (`continue-on-error`); when it succeeds, its zip/dmg entries are merged into that same `latest-mac.yml` and uploaded again. `combine-electron-manifests` still writes a final feed from whatever per-arch artifacts exist. Desktop smoke stays Apple Silicon only.

Local `electron:build` stays unsigned when `CSC_LINK` / `CSC_NAME` / `APPLE_ID` are unset. Unsigned and ad-hoc Mac builds can check for updates but cannot install in-place. `quitAndInstall()` fails there, `autoInstallOnAppQuit` stays off, and Desktop must not report Restart to Update as success. The update dialog hides in-app install and opens the GitHub release so the user can replace `Pichamber.app` from the `.dmg`. Developer ID / notarized builds still use Restart to Update.

Unsigned local builds are blocked by Gatekeeper until you remove quarantine and ad-hoc sign:

```sh
xattr -cr /Applications/Pichamber.app
codesign --force --deep --sign - /Applications/Pichamber.app
```

Set `APPLE_SIGNING=false` when `APPLE_ID` is present for iOS TestFlight but the Mac build must stay unsigned.

Windows/Linux desktop packaging is leftover and not the product target.

## Platform Notes

macOS packaging needs Xcode/build tools for notarized builds and icon asset compilation.

Windows packaging needs NSIS support through `electron-builder`. If no Windows signing env is set, `package.mjs` disables code signing and builds an unsigned installer. Windows updates use `latest.yml` for x64 and the `latest-arm64.yml` channel for ARM64 so each installation resolves an architecture-matching installer.

Linux AppImages must be built natively. Set `OPENCHAMBER_TARGET_ARCH=x64` or `OPENCHAMBER_TARGET_ARCH=arm64` when packaging; the build rejects a target that does not match the Linux host. The same target selects the bundled OpenCode CLI, native Electron rebuild, and Electron Builder architecture. Linux identity is stable across architectures: executable `pichamber`, desktop file `pichamber.desktop`, icon `pichamber`, and `StartupWMClass=pichamber`.

After packaging, run `bun run --cwd packages/electron verify:linux-appimage`. The verifier extracts the final AppImage and checks its ELF architecture, desktop identity, Electron executable, and packaged native `.node` modules. The leftover OpenCode CLI check runs only when that binary is packaged.

Running a packaged Linux AppImage requires FUSE (`libfuse.so.2`, typically `libfuse2` / `libfuse2t64` on Debian/Ubuntu). Without FUSE, start with `APPIMAGE_EXTRACT_AND_RUN=1`. Keep the AppImage on a writable path so in-app updates can replace it.

Desktop clears AppImage `ARGV0` from `process.env` before probing the login shell and starting the in-process server. Leaving it set makes zsh rewrite argv[0] for integrated-terminal and managed-OpenCode child commands to the AppImage path.

Linux updates are supported only when the packaged app is running from a writable AppImage. Update checks, downloads, and installation report an actionable error when `APPIMAGE` is missing, invalid, or read-only; a missing release feed (`latest-linux.yml` 404 before the first Linux publish) is treated as “no update available”. macOS and Windows updater behavior is unchanged. Release builds keep `latest-linux.yml` (x64) and `latest-linux-arm64.yml` separate and validate each manifest against its AppImage before upload. Linux AppImages download full updates (no `.blockmap` differential channel yet).

### Updater End-to-End Fixture

A loopback-only updater fixture is available for contributor QA of N-to-N+1 AppImage replacement and restart behavior. It is test infrastructure, not a user-configurable update source. See [`scripts/updater-e2e-fixture.md`](./scripts/updater-e2e-fixture.md) for the controlled test procedure. Unit tests cover feed selection, check failures, no-update results, and fixture generation; actual AppImage replacement and restart remains a manual native N-to-N+1 release boundary because it requires executing two packaged versions on each supported architecture.

The package supports macOS, Windows, and Linux desktop features. Linux AppImage builds include in-app window controls, auto-update, system tray (right-click Show / Hide / Close), and launch-at-login (XDG autostart). Opening files in installed apps, installed-app discovery, and FreeDesktop icon lookup (including the default file manager) work on macOS, Windows, and Linux.

On Windows and Linux, the General setting persisted as `desktopMinimizeToTrayEnabled` keeps the app running in the tray when the main window is **closed**. Minimize — the in-app control, the native title-bar button, and the taskbar — always performs a normal window minimize, so the taskbar entry stays available.

The macOS menu bar item is enabled by default and can be disabled in General settings. The setting applies after restart; while disabled, Desktop does not create the native tray controller or start the renderer subscriptions, polling, leftover OpenCode quota refresh, or IPC updates that feed it. On Pi the tray never fetches `/api/quota/*`.

## Bundled kernel (Pi)

Packaged Mac Desktop boots the app-bundled Pi SDK that ships with `@pichamber/web` (`@earendil-works/pi-coding-agent`) in a Node child. There is no bundled Pi CLI binary and no managed OpenCode child on the default path. User extensions load with that Node, not inside Electron. The child script is the unpacked `node-kernel-child.js` under `app.asar.unpacked`; packaged Desktop also ships `resources/node`. If Node cannot be resolved or the child cannot start, Desktop reports a clear error and recovery instead of starting a half-ready kernel or answering with the in-memory mock.

The leftover OpenCode CLI extraResource is optional. `prepare:opencode-cli` downloads it only when `OPENCHAMBER_BUNDLE_OPENCODE_CLI=1` or `OPENCHAMBER_KERNEL=opencode`. The OpenCode CLI settings page stays visible for that leftover path.

When the leftover OpenCode kernel is enabled, managed startup prefers binaries in this order:

1. `settings.opencodeBinary`.
2. Environment overrides: `OPENCODE_BINARY`, `OPENCODE_PATH`, `OPENCHAMBER_OPENCODE_PATH`, or `OPENCHAMBER_OPENCODE_BIN`.
3. The bundled Desktop CLI in `process.resourcesPath/opencode-cli`.
4. System installs discovered from PATH.
5. Known npm/Bun/Homebrew/Scoop/Chocolatey and other standard install locations.
6. Platform discovery through `where opencode` on Windows or a login shell on macOS/Linux.

Use an explicit override when testing a different OpenCode CLI build or when a user needs to point Desktop at a custom binary. The configured path must point to the standalone CLI, not the OpenCode Desktop app executable.

## Common Env Vars

| Variable | Use |
|----------|-----|
| `OPENCHAMBER_ELECTRON_DEV=1` | Marks the runtime as desktop development mode |
| `OPENCHAMBER_ELECTRON_USE_BUNDLED_UI=1` | Uses staged web assets instead of the HMR dev server |
| `OPENCHAMBER_SKIP_LOCAL_SERVER=1` | Skips the in-process local OpenChamber server and uses the configured default remote instance; Desktop imports this from the user's login-shell environment, and packaged/bundled UI remains available for connection recovery |
| `OPENCHAMBER_HMR_UI_PORT` | Preferred Vite UI port for desktop dev, default `5173` |
| `OPENCHAMBER_HMR_API_PORT` | Preferred API port for desktop dev, default `3901` |
| `OPENCHAMBER_RUNTIME=desktop` | Set by Electron before starting the web server |
| `OPENCHAMBER_KERNEL` | Desktop/server kernel. Defaults to `pi`. Set `opencode` to restore the leftover OpenCode process |
| `OPENCHAMBER_PI_NODE_KERNEL` | Desktop Pi session loader. Defaults on for Electron. Set `0` to keep sessions in-process (P0 skip + P1a electron tree). Set `1` to force the Node child |
| `PICHAMBER_NODE_BINARY` | Explicit Node executable for the Pi kernel child. Must be `node`, not PATH `pi`. If that binary cannot load the app Pi SDK, Desktop fails closed instead of mocking |
| `PICHAMBER_BUNDLED_NODE` | Staged packaged Node path; Desktop prefers this over PATH Node when `resources/node/bin/node` exists |
| `OPENCHAMBER_BUNDLE_OPENCODE_CLI` | Set `1` during `electron:build` to stage the leftover OpenCode CLI extraResource |
| `OPENCHAMBER_OPENCODE_CLI_VERSION` | Optional packaging override for the leftover OpenCode CLI version; defaults to the pinned root `@opencode-ai/sdk` version |
| `OPENCHAMBER_TARGET_ARCH` | Explicit desktop package architecture (`x64` or `arm64`); Linux requires it to match the native host |
| `OPENCHAMBER_DESKTOP_NOTIFY=true` | Enables desktop notification flow in the web server |
| `OPENCHAMBER_SKIP_API_COMPRESSION=true` | Defaulted by Desktop to reduce local CPU overhead |
| `OPENCHAMBER_STARTUP_PERF=1` | Enables privacy-safe startup phase timings in Desktop/server logs; disabled by default |
| `OPENCODE_HOST` / `OPENCODE_PORT` / `OPENCODE_SKIP_START` | Connect Desktop to an external OpenCode server instead of starting one locally |

## Native Features Owned Here

- Floating Mini Chat windows.
- Multiple native windows.
- Native notifications.
- User-confirmed local folder selection. The shared UI supplies the requested directory as the picker `defaultPath`; confirmation is required before filesystem access is retried.
- One-click open/reveal/open-in-app actions.
- Desktop host switcher and deep-link imports.
- Local and remote instance handling.
- SSH host import from the user's SSH config, connections (Connected / Connecting / Needs attention), logs, and port forwarding.
- Managed remotes resolve an absolute `pichamber` (or leftover `openchamber`) from home-directory installs and `command -v`. Start never uses a bare command name. A missing binary lists the paths that were checked. Disconnect with keep-running off stops the remote server via `pichamber stop`.
- A managed remote can bind `0.0.0.0` so other devices on the remote LAN can reach it; that requires a UI password.
- SSH uses OpenSSH ControlMaster on macOS/Linux. Windows uses independent hidden OpenSSH processes for setup commands and each long-lived forward because Win32 OpenSSH does not support ControlMaster reliably.
- Tunnel lifecycle integration through the web server runtime.
- Auto-update checks, downloads, and restart/apply flow.
- The browser panel's own session (`persist:openchamber-browser`): its storage is
  cleared only through the scoped clear-data command, and camera, microphone,
  location, and device-picker requests from pages shown there are denied. Electron
  grants permission requests by default when no handler is set, and the panel
  loads whatever address the user types. Tab favicons are fetched in this
  session too, so icons behind the page's own login resolve and the app's origin
  never requests anything from a third-party host.

## IPC Pattern

Renderer code should call the desktop bridge exposed by `preload.mjs`. Do not import Electron from shared UI code.

Add new native capabilities in this order:

1. Add or update the `preload.mjs` bridge only if a new renderer-facing shape is needed.
2. Add the real command handling in `main.mjs` under `openchamber:invoke`.
3. Gate privileged commands in main process logic so remote pages cannot access local filesystem or shell capabilities.
4. Keep shared UI runtime contracts in `packages/ui` and server/runtime APIs in `packages/web` when the behavior is not inherently native.

## Logs And Data

Electron uses `electron-log`. In development, console logs are also visible in the terminal. In packaged apps, logs are written through the platform log path for the `Pichamber` app name.

Development builds use a separate user data directory named `Pichamber Dev`, so dev state does not overwrite normal packaged app state.

## Things To Be Careful With

- Keep desktop-specific code in this package. Do not move OpenCode feature backend logic into Electron.
- Desktop windows set `acceptFirstMouse` so the first click on an unfocused window reaches the UI instead of only focusing the window.
- Use hidden Windows process launches for background helpers. Avoid visible console flashes.
- Keep `@pichamber/web`, `bun-pty`, `node-pty`, and native modules external in `bundle-main.mjs`; bundling them can break Electron startup.
- Rebuild native modules after dependency or Electron version changes.
- Test both HMR dev mode and bundled UI mode when changing startup, preload, routing, or packaged asset behavior.

## Quick Checks

```bash
bun run type-check:electron
bun run lint:electron
bun run electron:dev:bundled
```

For full repo validation before shipping:

```bash
bun run type-check
bun run lint
```
