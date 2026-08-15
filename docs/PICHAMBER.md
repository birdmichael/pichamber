# Pichamber on Pi

Pichamber keeps the OpenChamber UI (`@opencode-ai/sdk/v2`) and serves an OpenCode-shaped HTTP/SSE facade backed by [Pi](https://github.com/earendil-works/pi) (`@earendil-works/pi-coding-agent`).

The happy path does **not** require OpenCode to be installed.

## macOS Desktop (the product)

The product is the **macOS Electron app**. The web server is only the in-process backend that Desktop already starts. Do not treat the browser UI as the shipping surface.

1. On a Mac, install [bun](https://bun.sh) and Node 22+.
2. Clone this repo and install dependencies:

```bash
bun install
```

3. Configure Pi auth/models the usual way (`~/.pi/agent/auth.json` and `~/.pi/agent/models.json`, or provider keys in the environment). The `pi` CLI on your PATH is optional; Desktop uses the in-process `@earendil-works/pi-coding-agent` SDK.
4. Run Desktop in development (HMR). This boots Pi by default — no OpenCode install is required:

```bash
bun run electron:dev
```

Useful variants:

```bash
bun run electron:dev:bundled          # packaged web assets instead of Vite HMR
OPENCHAMBER_KERNEL=opencode bun run electron:dev   # restore the leftover OpenCode process path
```

5. Package a Mac `.dmg` / `.zip` **on macOS** (a Linux VM cannot produce a usable Mac desktop build):

```bash
bun run electron:build
# same thing:
bun run --cwd packages/electron package
```

That verifies the Pi SDK, builds web assets, bundles Electron main, rebuilds native modules, and runs electron-builder. Output lands in `packages/electron/dist` as `Pichamber-<version>-mac-<arch>.dmg` and `.zip`.

- Unsigned local builds are the default when Apple signing env (`CSC_LINK` / `APPLE_ID`) is unset.
- Notarized release builds still need Xcode + Apple signing/notarization credentials.
- OpenCode CLI is **not** downloaded for the default Pi kernel. Set `OPENCHAMBER_BUNDLE_OPENCODE_CLI=1` only if you also want the leftover OpenCode CLI extraResource.

`OPENCHAMBER_KERNEL` defaults to `pi` in both Desktop and the in-process server. Set `OPENCHAMBER_KERNEL=opencode` to restore the upstream OpenCode process + proxy.

On the Pi kernel, Usage/MCP/Plugins are hidden. Agents is the built-in `pi` agent (read-only). Share, revert, and session.shell remain empty-success stubs. Skills and commands write to `~/.pi/agent` and `.pi`, not `.opencode`. Walkthrough review uses the current Pi model from `~/.pi/agent` / `GET /api/pi/models` — never a hardcoded model.

### In-process web server only

Use the web server directly only when debugging the Desktop backend:

```bash
OPENCHAMBER_KERNEL=pi bun run start:web
# or, during development:
OPENCHAMBER_KERNEL=pi bun run dev
```

### Mock kernel (no LLM keys)

```bash
OPENCHAMBER_KERNEL=pi OPENCHAMBER_PI_MOCK=1 bun run start:web
```

Useful for UI/bootstrap work. Prompts stream a canned reply and still exercise session create, SSE, and abort.

## What the Pi facade implements

- Session CRUD, `prompt_async` / `prompt`, abort, messages, status
- Providers from `ModelRuntime.getAvailable()` (or a mock provider)
- Event mapping: `text_delta` → `message.part.delta` field `text`; `thinking_delta` → reasoning; `tool_execution_*` → tool parts; `agent_start` → busy; `agent_settled` → idle
- Empty-success stubs so bootstrap does not crash: MCP, LSP, permission, question, share, revert
- `GET /api/find/files` (and `/find/files`) for composer @ file search

## Still OpenCode-only / not ported

- Native OpenCode plugins, MCP OAuth, LSP diagnostics, permission/question dialogs, share, revert, and the managed OpenCode upgrade/binary resolver
- VS Code, mobile, Windows, and Linux desktop packaging were not the product target for this kernel swap

## Tests

```bash
cd packages/web
bunx vitest run server/lib/pi

bun test --cwd packages/electron ./kernel-env.test.mjs
```
