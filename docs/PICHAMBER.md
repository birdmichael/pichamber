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

3. Configure Pi auth/models the usual way (`~/.pi/agent/auth.json` and `~/.pi/agent/models.json`, or provider keys in the environment). Settings → General can override the Pi agent directory (stored in `~/.config/pichamber/settings.json`). Resolution is: that setting, then `PI_CODING_AGENT_DIR`, then `~/.pi/agent`. Changing it does not copy the old tree; Save + Reload applies it. First install with no Pichamber settings file seeds every existing `{agentDir}/sessions/` cwd as an open project and selects the most recently updated one; skip tmp / missing / `node_modules` / leftover Cursor worktree paths, isolated `~/.config/pichamber/chats` and leftover `~/.config/openchamber/chats` directories, and the exact home folder. Those project-less sessions still appear in the sidebar Chats section. `projects: []` after Close Project is not first-install. The `pi` CLI on your PATH is optional; Desktop uses the app-bundled `@earendil-works/pi-coding-agent` SDK plus a resolved or packaged Node to load `{agentDir}/npm`. It does not spawn PATH `pi`.
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

That verifies the Pi SDK, stages a Node binary for the Desktop kernel child, builds web assets, bundles Electron main, rebuilds native modules, and runs electron-builder. Output lands in `packages/electron/dist` as `Pichamber-<version>-mac-<arch>.dmg` and `.zip`.

- Unsigned local builds are the default when Apple signing env (`CSC_LINK` / `CSC_NAME` / `APPLE_ID`) is unset.
- GitHub Release Mac builds import the Developer ID Application certificate in `APPLE_CERTIFICATE` and pin `CSC_NAME` (no `CSC_LINK` re-import), then notarize with `APPLE_ID` + `APPLE_PASSWORD` + `APPLE_TEAM_ID`. The job fails closed if that identity is missing or the notary ticket is not stapled. The first Developer ID notarization can stay In Progress for hours; later submits are usually fast. Apple Silicon `latest-mac.yml` is uploaded as soon as that job finishes so Desktop can see the update while Intel is still notarizing; a later successful Intel job merges its files into the same feed.
- OpenCode CLI is **not** downloaded for the default Pi kernel. Set `OPENCHAMBER_BUNDLE_OPENCODE_CLI=1` only if you also want the leftover OpenCode CLI extraResource.

`OPENCHAMBER_KERNEL` defaults to `pi` in both Desktop and the in-process server. Set `OPENCHAMBER_KERNEL=opencode` to restore the upstream OpenCode process + proxy.

On the Pi kernel, Settings Usage/Plugins stay hidden. Settings → General is a Pi section (agent directory and the bundled Pi version). Desktop does not run PATH `pi` and does not check npm for a newer kernel; app updates stay on About. Leftover OpenCode CLI binary and leftover Pichamber Tools toggles stay on `OPENCHAMBER_KERNEL=opencode`. Settings → Feature Plugins is the install catalog for the Goal, Plan, MCP, Subagents, Btw, Todo, Grok Usage, and Kimi Usage slots (eight cards with hardcoded UI impact tags for the chrome that appears after install, default npm packages, no source or start-command fields; nothing is auto-installed; install writes `{agentDir}/settings.json` `packages`; chrome follows those packages and ignores leftover `pichamber.json` `featurePlugins.*.enabled`). The Grok Usage slot (`npm:pi-xai`) is usage-only chrome: it never auto-installs and is not required to sign in. It never auto-installs `pi-xai-oauth` (that package conflicts with `pi-xai`); leftover `npm:pi-xai-oauth` still counts as this slot until uninstall. Product login for SuperGrok / X Premium stays on Settings → Providers (`/login xai`). When that slot is on, Work Status Usage and the Providers xAI card show allowance / cycle / expiry from `GET /api/pi/xai-usage` (not leftover `/api/quota/*`). The Kimi Usage slot (`npm:pi-kimi-code-console-usage`) is usage-only: it never auto-installs and is not required to sign in. Product login for Kimi Code stays on Settings → Providers (`/login kimi-coding`, provider id `kimi-coding`). Uninstalled, the user can still Add / Sign in with Kimi Code; there is no Kimi usage row, no usage block on the connected kimi-coding card, and no `/kimi-usage`. Uninstall does not delete `auth.json` `kimi-coding` credentials. When that slot is on, Work Status Usage and the Providers Kimi Code card show weekly quota and the 5-hour window from `GET /api/pi/kimi-usage` (not leftover `/api/quota/*`, not `packages/web/server/lib/quota/providers/kimi.js`, not moonshot.ai balance). Missing `pichamber.json` is not an off switch: a slot already listed in `settings.json` `packages` is on. New-session model and thinking follow `settings.json` `defaultProvider` / `defaultModel` / `defaultThinkingLevel` when the chamber file has no pin. Settings → Extensions lists those configured package names (installed version and Update / Update all via Pi `PackageManager.update` when a newer latest exists), not the npm wrapper `pi-extensions`. When the Plan slot is installed and enabled, the composer shows one Agent / Plan dropdown (Desktop and the hosted/Capacitor mobile composer), View Plan appears on the Desktop right rail and as a mobile workspace tab while Plan is on (including an empty “no plan yet” state), and Plan questions render as in-chat cards via Desktop `ctx.ui`. Settings → MCP and the Work Status MCP section appear only when the MCP slot is installed and enabled (`npm:pi-mcp-adapter` by default). Leftover `~/.config/mcp/mcp.json` or `.mcp.json` files do not reveal those surfaces. When the slot is on, the existing MCP editor reads and writes adapter files (`~/.config/mcp/mcp.json` for user, `<cwd>/.mcp.json` for project; enable/disable only touches `<cwd>/.pi/mcp.json` `disabled`) and never `.opencode/opencode.json`. After a write, idle sessions in that directory reload in place (`POST /api/session/:id/reload`) so tools refresh — that path does not emit `server.connected`. Work Status MCP status comes from the adapter (`connected` / `cached` / `failed` / `needs-auth` / `disabled`); lazy/`cached` is a valid row. Authorize uses the adapter `/mcp-auth` flow, not OpenCode `POST /mcp/:name/connect`. Work Status does not show leftover OpenCode provider-quota Usage; the Usage section appears when Feature Plugins Grok Usage or Kimi Usage is installed (session context % / cost stay in Session). Both installed: two provider groups, stable order xAI then Kimi Code. Tasks is first and appears only when the Todo slot (`npm:@juicesharp/rpiv-todo`) is installed and enabled; Subagents appear only when that slot is installed and enabled. Unscoped `rpiv-todo` does not enable Todo. The Tasks gate is the slot, not leftover OpenCode `todo.updated` stubs or the presence of `todo` tool calls. Live updates come from `todo` `tool_execution_end` TaskDetails mapped onto SSE `todo.updated`; hydrate / reload / compact replay the last matching `todo` toolResult details on that session branch. Parent Work Status does not show child-session todos. Clicking a live child or a `subagent` transcript card opens that child as a writable session (in-place on mobile / VS Code); the parent stays unchanged. Leftover adapter rows without a session id are not listed; a run still starting can show status only. Install does not spawn a reviewer. Work Status does not show leftover OpenCode `parentID` children as a Pi fleet. Listing agents with `subagent({ action: "list" })` is not a child run: it does not add a Work Status row or mint an empty chat. Empty-session welcome chips stay available, including Catch me up (`/catch-up`) and Start feature planning (`/plan-feature`). They are in-app Pichamber starters: a click sends the matching magic prompt through the Pi session host (`createSession` + prompt), not leftover OpenCode `prompt_async`. System prompt optimization stays hidden (OpenCode plugin). OpenChamber Session Goal stays hidden on Pi. When the Goal feature plugin is installed and enabled, the composer shows one Goal button that starts `/goal <objective>` on the current session. A goal stored with the Pi session UUID under `~/.pi/agent/sessions` still shows after reload if the plugin writes it. Scheduled Tasks is a Pichamber scheduler: the sidebar calendar and `/schedule-task` stay available, and Run now / due timers create a real Pi session in the project cwd and send the task prompt. Model and provider come from the task when they match Pi's runtime models, otherwise from the resolved agent dir / `GET /api/pi/defaults` — never a hardcoded provider. Multi-run stays available: the sidebar launcher picks 2 or more models from `GET /api/pi/models` (no upper cap) and starts one real Pi session per model. Agents is hidden on Pi (built-in `pi`, read-only / hidden). Plan and extra workers live on Feature Plugins (Plan / Subagents); model and thinking stay on Session Defaults. Share, revert, and session.shell are hidden; their facade routes return 501 unsupported rather than empty success. Skills, prompts/commands, and snippets write to Pi / `.agents` roots, not leftover `.opencode` or `~/.config/opencode`. Settings location keys use `source: "pi"` (or `agents`), not a relabelled `opencode` enum. `GET /api/config/skills` does not surface leftover OpenCode trees as managed Pi skills. `GET /api/command` lists `compact`, `login`, custom prompts from `~/.pi/agent/prompts` (and project `.pi/prompts`), live extension commands from sessions in that directory after create/reload (`source: "extension"`), and Feature Plugin slashes that must appear before a session exists (`/plan`, `/run`, `/btw`, `/xai-usage`, `/kimi-usage` when those slots are installed). Optional `?session=` pins the live session. `POST /api/session/:id/command` dispatches extension commands through `AgentSession.prompt` (not `promptAsync`), expands markdown prompts as chat, returns 400 for `/reload`, and returns 404 for unknown names. The composer only POSTs that route for names in the command list (plus `/run` / `/plan` / `/goal`); an unknown `/name` is sent as a normal chat turn. `/btw` is listed only when Feature Plugins `btw` (`npm:@narumitw/pi-btw`) is installed; the composer intercepts that live command for the fork panel and does not POST `session.command`. Without the package, `/btw` is a normal chat turn. `/run` is listed when the Subagents slot is on: bare `/run` explains that it needs an agent and a task, and `/run <agent> <task>` starts a Work Status child or surfaces an error instead of a dead chat bubble. Reload stays on `POST /api/config/reload`, session-scoped `POST /api/session/:id/reload`, and `host.reload()` — not as a slash or Settings command. A session reload is 409 while that session is streaming or compacting and does not emit `server.connected`. Model and thinking stay on the composer chips and Session Defaults, not as Settings or slash entries. Walkthrough review uses the current Pi model from `~/.pi/agent` / `GET /api/pi/models` — never a hardcoded model.


| Kind | User | Project |
| --- | --- | --- |
| Skills | `{agentDir}/skills` (default `~/.pi/agent/skills`) | `<cwd>/.pi/skills` |
| Prompts / commands | `{agentDir}/prompts` (default `~/.pi/agent/prompts`) | `<cwd>/.pi/prompts` |
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

`GET /health` reports which kernel is serving the process. It does **not** pretend OpenCode is running when the kernel is Pi. On Pi it also omits leftover OpenCode binary-resolution fields (`opencodeBinaryResolved`, launch spec). Help → Diagnostics lists the bundled Pi Node child (`piNodeRuntime`), not `~/.opencode/bin/opencode`.

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
  "piRunning": true,
  "piBinaryResolved": "/opt/homebrew/bin/pi",
  "piBinarySource": "path"
}
```

`piBinaryResolved` / `piBinarySource` are chooser/local-setup detection only (PATH, `~/.bun/bin/pi`, `/opt/homebrew/bin/pi`, `~/.hermes/node/bin/pi`, npm global, `command -v pi`). Startup-failed / Local Pi unavailable recovery shows Pi install/docs from the same kernel, not OpenCode curl. Desktop still does not spawn PATH `pi`. The leftover OpenCode kernel omits those fields and keeps `opencodeBinaryResolved`.

- Pi-ready: `kernelReady` / `piRunning`, or `kernel === "pi"` and `status === "ok"`.
- OpenCode-ready: `openCodeRunning` and `isOpenCodeReady` on `kernel: "opencode"`.

Onboarding and bootstrap wait on those Pi signals. They must not treat the OpenCode flags as proof that a leftover OpenCode process exists.

## What the Pi facade implements

- Session CRUD, `prompt_async` / `prompt`, abort, messages (`GET /api/session/:id/message` and `GET /api/session/:id/message/:messageID`), status. Abort force-idles the session (and cancels waiting Desktop `ctx.ui` prompts) even when Pi `abort()` is a no-op after the visible reply already finished. A prompt that returns without `agent_settled` is settled by the host so Composing cannot stick. New sessions use Pi's persisted UUID under `~/.pi/agent/sessions`; `GET /api/session/:id` and `.../message` open a listed disk session after restart (same id as `pi` CLI for that cwd). Cold hydrate walks that jsonl and maps assistant `toolCall` plus a later `toolResult` (`toolCallId`) onto the same assistant `type: tool` parts as live SSE; `toolResult` is never a user message. Pi `image` blocks hydrate as facade `file` parts (`mime` + data URL) and stay on the user message after send, reopen, or sidebar Refresh. Assistant `provider` / `model` / `usage` hydrate onto facade `info` so the Desktop footer still shows the model that ran (and tokens/cost when they were recorded) instead of only `pi`. Session Goal metadata and Archive (`{ archived: ms | 0 }`) are written through the same `PATCH /api/session/:id` path and stored as a Pi `custom` entry (`pichamber.metadata`) on that jsonl so the goal and archive flag survive reload. `0` means restored. Archiving also moves the jsonl into a sibling `archive/` so the daily session list does not open those files; restore moves it back. Last-session restore does not reopen an archived chat. When the Subagents feature-plugin slot is on, `GET /api/session/:id/subagent-runs` lists adapter children and `GET /api/session/:id/children` returns attached child session infos (not leftover `parentID` clones). A child with a session file is a real facade session (`prompt` / steer stay on that child).
- Slash commands: `GET /api/command` (and `/command`) is `compact`, `login`, markdown prompts, live session `getCommands()` extension entries after reload, and Feature Plugin slashes (`/goal`, `/plan`, `/run`, `/btw`, `/xai-usage`, `/kimi-usage` when those slots are on). It does not advertise `reload`. `POST /api/session/:id/command` is the command channel: extension names call `session.prompt("/name args")` with `expandPromptTemplates` left on; `/reload` is 400; unknown names are 404. The composer calls that route only for listed/registered names (plus `/run` / `/plan` / `/goal`); unknown `/name` falls through to `prompt_async` as chat. `/btw` is listed as `source: "extension"` only when Feature Plugins `btw` is installed; the composer intercepts that live command for the fork panel and does not POST `session.command`. Without the package, `/btw` is a normal chat turn. `/run` is listed when the Subagents slot is on and must start a child or surface an error; a hung scout does not leave a silent parent bubble. `prompt_async` is not used for extension handlers. Session-scoped `POST /api/session/:id/reload` and `host.reload({ sessionID })` stay; they do not emit `server.connected` and return 409 while that session is streaming or compacting. Process-wide `host.reload()` / Settings Reload Pi interrupts a streaming or stuck-busy turn (`session.error` plus a continue notification) instead of hanging, and still 409s while compacting. Sidebar Refresh uses `POST /api/pi/sessions/reload` / `host.reloadSessionRecords()` to reload Pi and re-read the session list plus the open transcript from disk, still without `server.connected`.
- Providers from `ModelRuntime.getAvailable()` (`GET /api/config/providers` is the live connected list and must not keep a model-less xAI stub or a Pi builtin catalog provider such as Anthropic unless `auth.json` or `models.json` has that provider). `GET /api/provider` is `{ all, default, connected }`: `all` merges the built-in xAI and Kimi Code (`kimi-coding`) catalog stubs so Add Provider works before login; Settings Add opens Other / Custom when every catalog id is already connected. Mock kernel still returns only `pi-mock`
- Provider auth and custom providers: `PUT /api/auth/:id` (and `/auth/:id`) writes `~/.pi/agent/auth.json`; `POST /api/provider/:id/oauth/authorize` and `/callback` run Pi's built-in xAI SuperGrok / X Premium or Kimi Code (`kimi-coding`) device-code login and persist oauth (Pi refreshes the token); other ids are 404; `PUT /api/provider` writes `~/.pi/agent/models.json` and maps the Settings protocol (`openai-chat` / `openai-responses` / `anthropic-messages`) onto Pi `api`; `GET /api/provider` includes `options.baseURL` from `models.json`, `api`, and `env` from `$VAR` so Settings can edit a saved custom provider; `POST /api/provider/models` lists remote OpenAI-compatible models from the form base URL (stored keys only go to the saved provider origin; never returns the key; does not follow redirects); `DELETE /api/provider/:id/auth` disconnects
- `GET /api/pi/xai-usage` when Feature Plugins `xai` is installed: subscription allowance / cycle / token expiry from the plugin billing `config` envelope (`creditUsagePercent`, period end, cents wrappers) plus `auth.json` `expires`. Slot off or missing oauth is not empty success. Failure keeps the last good client snapshot and does not invent 0% usage. Leftover `/api/quota/*` stays unregistered on Pi.
- `GET /api/pi/kimi-usage` when Feature Plugins `kimi` (`npm:pi-kimi-code-console-usage`) is installed: weekly quota and 5-hour window from `https://api.kimi.com/coding/v1/usages` plus `auth.json` `kimi-coding`. Slot off is `{ slotActive: false }` with no outbound HTTP even if logged in. Missing credentials is not empty success. Failure keeps the last good client snapshot and does not invent 0% usage. Leftover `/api/quota/*` and `quota/providers/kimi.js` stay unused. Product login is built-in `/login kimi-coding`, not the Feature Plugin.
- Event mapping: `text_delta` → `message.part.delta` field `text`; `thinking_delta` → reasoning; `tool_execution_*` → tool parts; successful `plan_mode_complete` → `pi.plan.updated` with the ready markdown; `agent_start` → busy; `agent_settled` → idle; successful `compaction_end` → `session.compact` end plus `session.compacted` (pin inject). Abort or failed compact does not emit `session.compacted`.
- Desktop `ctx.ui` on every live `AgentSession` (`select` / `confirm` / `input` / `editor` / `notify`). Plan questions and installed `question` tool turns render as in-chat cards on that turn (options and/or input) and resolve the waiting extension promise. Opening a session hydrates pending `GET /api/pi/ui` cards onto the asking turn even when the transcript is empty. `pi.ui.notify` is a desktop toast (`/plan start` is toast-only, not a question-card probe). OpenCode `/api/question` stays an empty stub.
- Session plan chrome when Feature Plugins `plan` is installed and enabled: `GET|POST /api/pi/session/:id/plan` from live `plan-mode-state` (not TUI, not `.opencode/plans`). Composer **Agent / Plan** is one dropdown (current side on the trigger) that shows on an idle empty session (status defaults to `off`) and uses `/plan start` (toast only; not a question-card probe). Bare `/plan` from the slash menu still opens the plugin launch card and must appear as live `/plan`, not only `/plan-feature`. View Plan rail (and the hosted/Capacitor mobile workspace Plan tab) while Plan is `active`/`ready`/`saved`/`implementing` (empty “no plan yet” when the model never wrote markdown), and Build (answers a pending plan-ready select as Implement here, otherwise `/plan implement` in this session) only when markdown exists. Leave a ready plan saves; leave Plan with no document uses `/plan exit`. Discard is confirm + `/plan exit` from the panel only, and stays disabled until a ready, saved, or implementing document exists. A saved plan resumes without `/plan start`.
- MCP status and config when the feature-plugin slot is installed and enabled: `GET /api/mcp` reports adapter status (or `cached`/`disabled` from adapter files when no live snapshot exists); `GET|POST|PATCH|DELETE /api/config/mcp` reads/writes adapter files. The slot-off case returns no servers and does not invent OpenCode MCP config. LSP, permission, and question remain empty-success stubs so bootstrap does not crash.
- Composer Goal button when Feature Plugins `goal` is installed and enabled. Click opens a modal; a required objective runs `session.command` → `session.prompt("/goal <objective>")`. Bare `/goal` is rejected. A missing live command errors and is not sent as chat. OpenChamber Session Goal stays hidden on Pi.
- Desktop Electron agents drive the right-rail Browser via host tool `pichamber_web` (Settings → Pichamber Tools). The leftover OpenCode plugin name `openchamber_web` is not attached on Pi.
- Desktop Electron agents can create sessions and scheduled tasks via host tool `pichamber` when Settings → Pichamber Tools → Agent control is on. Session create/send/fork stay on the Pi host (no HTTP to the local facade; on Desktop those host methods IPC to the Node child that loads `{agentDir}/npm`). The leftover OpenCode plugin name `openchamber` is not attached on Pi.
- Hidden OpenCode-only stubs (501 unsupported, not offered in the UI): share, unshare, revert, session.shell
- `GET /api/find/files` (and `/find/files`) for composer @ file search
- Session export/import: `GET|POST /api/session/:id/export?format=jsonl|html` and `POST /api/session/import`. JSONL export writes Pi-native `text` / `thinking` / `toolCall` / `toolResult` / `image` so import reconstructs the same facade parts, and keeps assistant `provider` / `model` / `usage` when they already exist. HTML export (`buildSessionHtml`) writes a self-contained offline file that matches the accepted share-chrome preview: Pichamber mark, GitHub + light/dark toggle (`pichamber-export-theme`), Pi coding-agent version, last usable model, user bubbles, thinking as muted unboxed paragraphs, settled `ctx.ui` questions, collapsed tools, Markdown answers, horizontal 1px left-gutter ticks, and a `pichamber` footer. Images are embedded `data:` URLs. Remote http(s) image URLs are omitted or labeled. It does not create a public share URL. JSONL stays the round-trip / re-import format.
- Project trust: `GET|PUT|POST /api/pi/trust` (`~/.pi/agent/trust.json` + `defaultProjectTrust`)
- Skills: `GET /api/skill` and `GET /api/pi/skills` walk `~/.pi/agent/skills`, `~/.agents/skills`, and the project `.pi/skills` / `.agents/skills` trees. The walk follows directory symlinks, skips cycles and broken links, and lists each resolved `SKILL.md` once. Settings detail (`GET /api/config/skills/:name`) uses that same walked path so nested symlink skills keep their YAML `|` / `>` block text instead of an empty editor. Project skills stay `injected: false` until the project is trusted. Leftover `~/.config/opencode/skills` and `~/.opencode/skills` are not first-class Pi roots.
- Scoped models: `enabledModels` on `GET|PATCH /api/pi/defaults` (`~/.pi/agent/settings.json`)
- Provider auth write: `PUT /api/auth/:provider` and `DELETE /api/auth/:provider` (SDK `auth.set` / `auth.remove`) plus `DELETE /api/provider/:providerId/auth` (Settings disconnect). These update `~/.pi/agent/auth.json` in Pi's `{ type: "api_key", key }` / oauth shape for whatever provider id is in the URL.

## Still OpenCode-only / not ported

- Native OpenCode plugins, LSP diagnostics, OpenCode permission/question dialogs, share, revert, and the managed OpenCode upgrade/binary resolver. Pi extension prompts use Desktop `ctx.ui`, not OpenCode `/api/question`. MCP OAuth on Pi goes through `pi-mcp-adapter` `/mcp-auth`, not the leftover OpenCode connect route.
- VS Code, Windows, and Linux desktop packaging were not the product target for this kernel swap. Hosted mobile / Capacitor is a touch client of the same Pi host: Settings, View Plan, session chrome (Scheduled Tasks, Multi-run, Archive+restore, Pi Refresh), Work Status (header context ring: session, branch, context %, Tasks when the Todo slot is on, MCP, Subagents), and Git-opened Pull Request now follow the same Pi APIs and Desktop views. File diffs stay inline on phones and use Desktop DiffView on tablet. Walkthrough is tablet-only (`WALKTHROUGH_MIN_WIDTH`). Browser stays unsupported (no Electron Chromium session). Desktop-native privileges (SSH, External Tunnel host, Electron browser session) stay unsupported.

## Tests

```bash
cd packages/web
bunx vitest run server/lib/pi

bun test --cwd packages/electron ./kernel-env.test.mjs
```

Desktop (`process.versions.electron` set) loads user Pi extensions in a
Node child that runs the app-bundled `@earendil-works/pi-coding-agent`
plus a resolved or packaged Node. User `.node` files are not `dlopen`'d
in Electron, so a normal system `npm install` works without an Electron
rebuild. Desktop prefers the app-bundled Node over PATH Node and does
not spawn PATH `pi`. The child script is the asar-unpacked
`node-kernel-child.js`, not `resources/pi-node-kernel/`. Missing Node
is `PI_NODE_UNAVAILABLE`. A Node that cannot import the app Pi SDK is
`PI_SDK_UNAVAILABLE` and is not described as missing Node.js. Neither
case starts a mock or half-up kernel, including when opening an
existing session.
`OPENCHAMBER_PI_NODE_KERNEL=0` restores the leftover in-process path
(P0 skip + optional `{agentDir}/npm-electron/…` tree).

## Product mark

Pichamber is the desktop client for Pi. The mark is OpenChamber's isometric open-top cube (the chamber) with the official Pi pixel-art "pi" wordmark in the **same top-face slot** as the old OpenCode O (`scale(0.068)`, isometric center). Not a copy of `pi.dev/favicon.svg`, not a Greek π, not a window/traffic-light, and not the rejected inside-the-volume `scale(0.115)` / `ty=6` placement.

SVG masters and the generator live in `packages/electron/resources/icons` and `packages/electron/scripts/generate-product-icons.mjs`. See `packages/electron/README.md`.

## Branch and version

Pichamber is a new product line on this fork. Versioning starts at **1.0.0** and is independent of upstream OpenChamber version numbers. The current release is **1.2.11**. The default kernel is in-process Pi.

- Default branch: `main` (Pi kernel).
- The pre-Pi OpenChamber line is preserved as `legacy/openchamber`.
- Do not open PRs against upstream `openchamber/openchamber`.
- Land one verified feature per PR into `main`. Do not pile unrelated Pi work into a single pull request.
