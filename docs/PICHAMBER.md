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

On the Pi kernel, Settings Usage/MCP/Plugins are hidden, Settings → Feature Plugins is the install/enable page for the Goal, Plan, MCP, and Subagents slots (nothing is auto-installed; install writes `~/.pi/agent/settings.json` `packages` and enable flags live in `~/.pi/agent/pichamber.json`), and Work Status does not show the OpenCode provider-quota Usage block (session context % / cost stay). Empty-session welcome chips stay available, including Catch me up (`/catch-up`) and Start feature planning (`/plan-feature`). They are in-app Pichamber starters: a click sends the matching magic prompt through the Pi session host (`createSession` + prompt), not leftover OpenCode `prompt_async`. System prompt optimization stays hidden (OpenCode plugin). Session Goal is a Pichamber feature: the composer target button, objective counter, and Settings Chat toggle / default budget stay visible. A goal is stored with the Pi session UUID under `~/.pi/agent/sessions` and still shows after reload. Scheduled Tasks is a Pichamber scheduler: the sidebar calendar and `/schedule-task` stay available, and Run now / due timers create a real Pi session in the project cwd and send the task prompt. Model and provider come from the task when they match Pi's runtime models, otherwise from `~/.pi/agent` / `GET /api/pi/defaults` — never a hardcoded provider. Multi-run stays available: the sidebar launcher picks 1–5 models from `GET /api/pi/models` and starts one real Pi session per model. Agents is the built-in `pi` agent (read-only). Share, revert, and session.shell are hidden; their facade routes return 501 unsupported rather than empty success. Skills, prompts/commands, and snippets write to Pi / `.agents` roots, not leftover `.opencode` or `~/.config/opencode`. Settings location keys use `source: "pi"` (or `agents`), not a relabelled `opencode` enum. `GET /api/config/skills` does not surface leftover OpenCode trees as managed Pi skills. `GET /api/command` lists `compact`, `login`, custom prompts from `~/.pi/agent/prompts` (and project `.pi/prompts`), and live extension commands from sessions in that directory after create/reload (`source: "extension"`). Optional `?session=` pins the live session. `POST /api/session/:id/command` dispatches extension commands through `AgentSession.prompt` (not `promptAsync`), expands markdown prompts as chat, returns 400 for `/reload`, and returns 404 for unknown names. The composer only POSTs that route for names in the command list; an unknown `/name` is sent as a normal chat turn. Reload stays on `POST /api/config/reload`, session-scoped `POST /api/session/:id/reload`, and `host.reload()` — not as a slash or Settings command. A session reload is 409 while that session is streaming or compacting and does not emit `server.connected`. Model and thinking stay on the composer chips and Session Defaults, not as Settings or slash entries. Walkthrough review uses the current Pi model from `~/.pi/agent` / `GET /api/pi/models` — never a hardcoded model.

| Kind | User | Project |
| --- | --- | --- |
| Skills | `~/.pi/agent/skills` | `<cwd>/.pi/skills` |
| Prompts / commands | `~/.pi/agent/prompts` | `<cwd>/.pi/prompts` |
| Compatibility (read) | `~/.agents/skills` | `<cwd>/.agents/skills` |

`.agents` stays as a documented compatibility root. Leftover `.opencode` / `~/.config/opencode` paths remain valid only on `OPENCHAMBER_KERNEL=opencode`.

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

## Health

`GET /health` reports which kernel is serving the process. It does **not** pretend OpenCode is running when the kernel is Pi.

On Pi (`OPENCHAMBER_KERNEL=pi`, the default):

```json
{
  "status": "ok",
  "kernel": "pi",
  "piMock": false,
  "openCodeRunning": false,
  "isOpenCodeReady": false,
  "openCodePort": null,
  "kernelReady": true,
  "piRunning": true
}
```

- Pi-ready: `kernelReady` / `piRunning`, or `kernel === "pi"` and `status === "ok"`.
- OpenCode-ready: `openCodeRunning` and `isOpenCodeReady` on `kernel: "opencode"`.

Onboarding and bootstrap wait on those Pi signals. They must not treat the OpenCode flags as proof that a leftover OpenCode process exists.

## What the Pi facade implements

- Session CRUD, `prompt_async` / `prompt`, abort, messages, status. New sessions use Pi's persisted UUID under `~/.pi/agent/sessions`; `GET /api/session/:id` and `.../message` open a listed disk session after restart (same id as `pi` CLI for that cwd). Session Goal metadata is written through the same `PATCH /api/session/:id` path and stored as a Pi `custom` entry (`pichamber.metadata`) on that jsonl so the goal survives reload.
- Slash commands: `GET /api/command` (and `/command`) is `compact`, `login`, markdown prompts, and live session `getCommands()` extension entries after reload. It does not advertise `reload`. `POST /api/session/:id/command` is the command channel: extension names call `session.prompt("/name args")` with `expandPromptTemplates` left on; `/reload` is 400; unknown names are 404. The composer calls that route only for listed/registered names; unknown `/name` falls through to `prompt_async` as chat. `prompt_async` is not used for extension handlers. Session-scoped `POST /api/session/:id/reload` and `host.reload()` stay; they do not emit `server.connected` and return 409 while that session is streaming or compacting.
- Providers from `ModelRuntime.getAvailable()` (or a mock provider)
- Provider auth and custom providers: `PUT /api/auth/:id` (and `/auth/:id`) writes `~/.pi/agent/auth.json`; `PUT /api/provider` writes `~/.pi/agent/models.json`; `GET /api/provider` includes `options.baseURL` from `models.json` and `env` from `$VAR` so Settings can edit a saved custom provider; `POST /api/provider/models` lists remote OpenAI-compatible models from the form base URL (stored keys only go to the saved provider origin; never returns the key; does not follow redirects); `DELETE /api/provider/:id/auth` disconnects
- Event mapping: `text_delta` → `message.part.delta` field `text`; `thinking_delta` → reasoning; `tool_execution_*` → tool parts; `agent_start` → busy; `agent_settled` → idle
- Desktop `ctx.ui` on every live `AgentSession` (`select` / `confirm` / `input` / `editor` / `notify`). Plan questions render as in-chat cards and resolve the waiting extension promise. Opening a session hydrates pending `GET /api/pi/ui` cards even when the transcript is empty. `pi.ui.notify` is a desktop toast (`/plan start` is toast-only, not a question-card probe). OpenCode `/api/question` stays an empty stub.
- Session plan chrome when Feature Plugins `plan` is installed and enabled: `GET|POST /api/pi/session/:id/plan` from live `plan-mode-state` (not TUI, not `.opencode/plans`). Composer **Agent | Plan** uses `/plan start` (toast only; not a question-card probe). Bare `/plan` from the slash menu still opens the plugin launch card. View Plan rail when markdown exists, and Build (`/plan implement` in this session). Leave Plan saves; discard is confirm + `/plan exit` from the panel only. A saved plan resumes without `/plan start`.
- Empty-success stubs so bootstrap does not crash: MCP, LSP, permission, question
- Hidden OpenCode-only stubs (501 unsupported, not offered in the UI): share, revert, session.shell
- `GET /api/find/files` (and `/find/files`) for composer @ file search
- Session export/import: `GET|POST /api/session/:id/export?format=jsonl|html` and `POST /api/session/import`
- Project trust: `GET|PUT|POST /api/pi/trust` (`~/.pi/agent/trust.json` + `defaultProjectTrust`)
- Skills: `GET /api/skill` and `GET /api/pi/skills` walk `~/.pi/agent/skills`, `~/.agents/skills`, and the project `.pi/skills` / `.agents/skills` trees. The walk follows directory symlinks, skips cycles and broken links, and lists each resolved `SKILL.md` once. Settings detail (`GET /api/config/skills/:name`) uses that same walked path so nested symlink skills keep their YAML `|` / `>` block text instead of an empty editor. Project skills stay `injected: false` until the project is trusted. Leftover `~/.config/opencode/skills` and `~/.opencode/skills` are not first-class Pi roots.
- Scoped models: `enabledModels` on `GET|PATCH /api/pi/defaults` (`~/.pi/agent/settings.json`)
- Provider auth write: `PUT /api/auth/:provider` and `DELETE /api/auth/:provider` (SDK `auth.set` / `auth.remove`) plus `DELETE /api/provider/:providerId/auth` (Settings disconnect). These update `~/.pi/agent/auth.json` in Pi's `{ type: "api_key", key }` / oauth shape for whatever provider id is in the URL.

## Still OpenCode-only / not ported

- Native OpenCode plugins, MCP OAuth, LSP diagnostics, OpenCode permission/question dialogs, share, revert, and the managed OpenCode upgrade/binary resolver. Pi extension prompts use Desktop `ctx.ui`, not OpenCode `/api/question`.
- VS Code, mobile, Windows, and Linux desktop packaging were not the product target for this kernel swap

## Tests

```bash
cd packages/web
bunx vitest run server/lib/pi

bun test --cwd packages/electron ./kernel-env.test.mjs
```

## Product mark

Pichamber is the desktop client for Pi. The mark is OpenChamber's isometric open-top cube (the chamber) with the official Pi pixel-art "pi" wordmark in the **same top-face slot** as the old OpenCode O (`scale(0.068)`, isometric center). Not a copy of `pi.dev/favicon.svg`, not a Greek π, not a window/traffic-light, and not the rejected inside-the-volume `scale(0.115)` / `ty=6` placement.

SVG masters and the generator live in `packages/electron/resources/icons` and `packages/electron/scripts/generate-product-icons.mjs`. See `packages/electron/README.md`.

## Branch and version

Pichamber is a new product line on this fork. Versioning starts at **1.0.0** and is independent of upstream OpenChamber 1.18.x.

- Default branch: `main` (Pi kernel).
- The pre-Pi OpenChamber line is preserved as `legacy/openchamber`.
- Do not open PRs against upstream `openchamber/openchamber`.
- Land one verified feature per PR into `main`. Do not pile unrelated Pi work into a single pull request.
