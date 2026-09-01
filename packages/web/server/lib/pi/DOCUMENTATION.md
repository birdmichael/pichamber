# Pi host and facade

Owning module for the Pi kernel: session host, OpenCode-shaped HTTP/SSE
facade, Desktop `ctx.ui`, command dispatch, reload, and the Desktop Node
child that loads `{agentDir}/npm`. Product behavior is documented in
`docs/PICHAMBER.md`.

## Pi agent directory

`resolvePiAgentDir` is the only resolver. Order:

1. Non-empty persisted `settings.piAgentDir` (`~/.config/openchamber/settings.json`)
2. `process.env.PI_CODING_AGENT_DIR`
3. `{home}/.pi/agent`

Do not mutate `PI_CODING_AGENT_DIR` from the UI. Pass the resolved path into
SDK calls (`agentDir`, `authPath`, `modelsPath`, `SettingsManager`,
`SessionManager`, `ModelRuntime.create`). `host.reload()` re-resolves; a
settings write without reload leaves the live host on the previous tree.
Empty string clears the override. Changing the directory does not copy
`~/.pi/agent`. Creating an empty agent dir on first use is OK.

`GET /api/path` and `getKernelInfo().paths` report the resolved dir.
`GET /api/pi/upgrade-status` reports the local bundled
`@earendil-works/pi-coding-agent` version only (`currentVersion`,
`available: false`, `latestVersion: null`). It does not fetch npm.
Settings → General and About use that payload for the installed version.
`upgrade.supported` stays `false` (`reason: "bundled"`): Desktop runs the
app-bundled SDK, not PATH `pi`, so Settings has no Pi Update and
`POST /api/pi/upgrade` returns 403. App updates stay on About /
electron-updater. The leftover `runPiSelfUpdate` path is not reachable
while `upgrade.supported` is false.

`GET /api/pi/extensions` lists configured `settings.json` `packages` plus
`currentVersion` / `latestVersion` / `updateAvailable` (npm registry
`/latest`, 10s timeout, at most 4 in flight, short in-process TTL cache
keyed by package name; honor `PI_OFFLINE` / `PI_SKIP_VERSION_CHECK`). `POST
/api/pi/extensions/update` `{ source? }` calls Pi
`DefaultPackageManager.update(source)` (all configured packages when
`source` is omitted), then reloads idle sessions. `POST
/api/pi/extensions/uninstall` `{ source }` uses the same
`DefaultPackageManager.removeAndPersist(source)` path as Feature Plugins
uninstall (after the Settings confirm dialog), then reloads idle sessions.

## User extension natives on Desktop

Desktop product path: the HTTP facade and `createPiHost` orchestration
stay in Electron. The process that loads `{resolvePiAgentDir()}/npm` and
`<cwd>/.pi/npm` is a **Node child** (`node-kernel-child.js`) that runs
the app-bundled `@earendil-works/pi-coding-agent` plus a resolved Node
binary. User `.node` files are not `dlopen`'d in Electron.

Node resolution: `PICHAMBER_NODE_BINARY` / `OPENCHAMBER_NODE_BINARY`,
then the packaged `resources/node` binary (`PICHAMBER_BUNDLED_NODE`),
then PATH `node` (never `pi` / Electron / Bun), then well-known
system locations (`/opt/homebrew/bin/node`, `/usr/local/bin/node`,
`/usr/bin/node`, `/bin/node`) only when PATH is non-empty, then the
current `process.execPath` only when it is actually Node. An explicit
`nodeBinary` option that is missing or not Node fails closed — it does
not fall through to PATH or a host well-known Node. Empty PATH does
not invent a system Node. Electron `execPath` is never treated as
Node. Desktop therefore prefers the app-bundled Node over an
incompatible PATH Node. Feature Plugin install prepends that same
Node onto the child's `PATH`.
`packages/electron/scripts/prepare-node.mjs` stages a Node that can
`import` the app-bundled `@earendil-works/pi-coding-agent` and that
still runs after being copied into `resources/node` (official
current/LTS if the local binary is Homebrew-linked or cannot import).
Do not spawn PATH `pi`.

SDK location uses `import()` / `import.meta.resolve`, then walks up to
the `package.json` whose `name` is `@earendil-works/pi-coding-agent`.
Do not `require.resolve` the package or its `package.json` subpath —
ESM-only `exports` have no CJS main. `hello.sdk` reports that version
and packagePath when `import()` succeeds. A real `import()` failure
(including `markAsUncloneable`) stays `PI_SDK_UNAVAILABLE` and must
not be described as missing Node.js.

The child script is the module-relative `node-kernel-child.js` next to
`node-kernel-client.js`, rewritten through `toNodeReadablePath` so a
real Node reads `app.asar.unpacked/.../node-kernel-child.js`. Do not
resolve it from `resources/pi-node-kernel/`. That extraResource is not
staged, and a lone copied JS file would still miss the relative imports
and `@earendil-works/pi-coding-agent`. `resourcesPath` is only for
bundled Node (`resources/node/bin/node`). `prepare:node` must run in
packaging CI; `verify:pi-node-kernel:packaged` fails the build when
the bundled Node or unpacked child is missing, when the bundled
Node still depends on Homebrew / `libnode` dylibs, or when the
packaged Node cannot `import` the unpacked child and
`@earendil-works/pi-coding-agent` from that child's directory.
`afterPack` copies the child's asar-only production dependency
tree (`yaml`, `chalk`, and the rest of the SDK graph) into
`app.asar.unpacked/node_modules` so a real Node can resolve them.

Missing Node or an unusable Node (SDK import throws, including
`markAsUncloneable`): `host.ready()` returns false, `isReady()` is
false, `createSession` throws `PI_NODE_UNAVAILABLE` /
`PI_SDK_UNAVAILABLE` (503) with recovery text. The Node-child host
sets `allowInMemoryFallback: false`. That flag also covers
`hydratePersistedSession` and `attachSessionFromFile` — they must not
call `createInMemoryPiSession` or stream `Hello from the Pi mock
kernel.` Session list still reads disk jsonl. Opening or prompting an
existing session while the child is down is 503 + recovery, not a
canned reply. Empty `hello.sdk.packagePath` plus ready is a fail. That
is not a half-up kernel. Child crash: the Desktop shell stays up;
`host.reload()` respawns the child; interrupted turns keep
`session.error` plus `opencode-restart-interrupted`. Quit /
`handle.disposePiKernel()` / `process.exit` kill that child
with SIGTERM then SIGKILL. They also reap leftover
`pi-chrome-cdp-*` Chrome processes. Those windows detach from
the child, so killing the child alone leaves them on the
desktop. Do not rely on `killSidecar()`'s leftover OpenCode
killer for the Pi child. `ctx.ui`, session
create/prompt/fork, scheduled-task session create, and `pichamber`
create-send-fork stay on the parent host and reach the child over IPC
(not HTTP). The parent host owns the product chat stream: `promptAsync`
inserts the user bubble, then raw `session-event` from `wrapSession`
goes through the parent translator. Child `createPiHost` still translates
for its own record. `host-event` carries `session.created` /
`session.updated` / `pi.ui.*` so child-created sessions and extension UI
reach the parent. `message.*`, `session.status`, and `session.idle` on
the product bus come only from that parent translator. `wrapSession`
subscribes once per Pi session. IPC `createSession` cannot carry a live `SessionManager`.
The payload is `cwd`, `sessionFile`, `sessionID`, and optional
`title` / `model`. When `sessionFile` or `sessionID` is present the
child `ensureSession`s that jsonl. It does not `SessionManager.create`
a second Untitled chat.
Parent `POST /api/session` is a shell create: persist the jsonl header,
emit `session.created`, and return the Pi UUID without waiting for the
live `AgentSession`. `promptAsync` / `runCommand` / `setSessionModel` /
`setSessionThinking` / `compactSession` / `runPlanAction` call
`ensureLiveRecord`, which binds extensions in the Node child (or
in-process factory) and reuses that id. Reload awaits the in-flight bind
instead of starting a second AgentSession. Delete and host dispose mark
the record disposed so a late bind cannot attach. `promptAsync` marks the
session busy and emits `session.status` before that bind so a targeted
`reload({ sessionID })` 409s during first-send bind. It still binds
before inserting the user message so a failed bind does not leave a ghost
turn and returns the session to idle. `GET` messages/list/session and
`getSessionUsage` stay live-free on the shell record (`available: false`
until `piSession.getContextUsage` exists).
`promptAsync` `delivery` is `steer` | `followUp` | `follow_up` | `queue`.
Busy is the session that was already live (`isStreaming` / compacting) or
already `busy`/`retry` *before this call marked busy*. Do not treat this
call's own status busy as a live turn — that would steer the first idle
send. Busy + `followUp` → `session.followUp`. Busy + `steer` or no
delivery → `session.steer`. Never `prompt()` while that turn is live (Pi
throws "Already streaming" / "Specify streamingBehavior"). Idle send is
always `prompt()`. The OpenCode SDK `session.promptAsync` allowlist drops
`delivery`; the client must also send `$body_delivery`.
`POST /api/pi/directory-runtime/warm` fire-and-forgets
`ensureDirectoryRuntime` for a cwd. Opening, hydrating, or reloading a live
record must pass the existing manager/file. `host.reload()` /
409-while-streaming stay the same.
`OPENCHAMBER_PI_NODE_KERNEL=0` restores the in-process fallback below.
`OPENCHAMBER_KERNEL=opencode` is unchanged.

P0 skip and the P1a electron tree remain as that in-process fallback.
They are not the Desktop product path. Do not revert P0. Do not rebuild
`{agentDir}/npm` in place for Electron.

On the in-process fallback (`process.versions.electron` non-empty and
the Node child off), a native `dlopen` failure whose error is the
`NODE_MODULE_VERSION` mismatch sentence skips **that user extension
only**. The kernel stays ready. Other extensions still load. Sessions
can still be created and prompted. Diagnostics keep the extension
source, `.node` path, `process.versions.modules`,
`process.versions.electron`, and the compiler ABI parsed from the error.
Do not hardcode ABI numbers or package names.

The skip layer is off when `process.versions.electron` is empty (CLI /
plain Node) so system-Node-built natives still load. App-owned natives
under `app.asar.unpacked` are not reported as skipped user extensions.

On the Desktop Node child the ABI is the **bundled Node**, not
Electron and not PATH / Homebrew Node. The child boot payload's
`agentDir` is `resolvePiAgentDir(home)`. `home` defaults to
`os.homedir()` when the server omits it — do not send a missing
`agentDir`, or isolate sync sees no `{agentDir}/npm` tree. Child boot
copies native packages from `{agentDir}/npm` into
`{agentDir}/npm-node/node-{modules}-{platform}-{arch}/{name}@{version}/`
and `npm rebuild`s them with the bundled Node. `require()` remaps
only `.node` files onto that tree; package JavaScript and
`node_modules` stay in `{agentDir}/npm`. `{agentDir}/npm` stays the
CLI / Homebrew install.
If `process.versions.node` is not a public `vX.Y.Z` release (Homebrew
alphas, nightlies), rebuild downloads official headers for the same
`NODE_MODULE_VERSION` and compiles against those. A failed isolate
stays stamped (`kind: official-headers`) and does not throw into the
host. Older failed stamps without that kind are retried after this
strategy. The `pi` CLI never reads `npm-node`. Do not rebuild
`{agentDir}/npm` in place for Electron or for the bundled Node.

The fallback also keeps a second prefix so the in-process kernel can
load natives without rewriting the CLI tree. `{agentDir}/npm` stays the
system-Node install. Isolated native packages live at
`{agentDir}/npm-electron/electron-{modules}-{platform}-{arch}/{name}@{version}/`
(and the same formula under `<cwd>/.pi/npm-electron`). `modules`,
`platform`, and `arch` come from the current Desktop process. An
Electron upgrade therefore misses the old cache directory.

PackageManager `install` / `update` (and session create/reload) is the
sync point for that fallback tree. Candidates match `@electron/rebuild`
discovery (`binding.gyp`, `prebuilds/`, native `package.json` metadata)
plus lazy capture when load-time ABI fails. A hit native package is
loaded as a whole package from the electron tree. N-API tries the
original file first and isolates only after that fails. Rebuild runs in
a child process; failure falls back to the skip above, does not throw
into the host, and does not mutate `{agentDir}/npm`. The `pi` CLI never
reads the electron tree.

## First-install project seed

When `~/.config/openchamber/settings.json` is missing, or the file exists
but has never persisted a `projects` key, settings migration walks
`{agentDir}/sessions/` and seeds those cwds as open projects. Read `cwd`
from the session jsonl header (first object). Do not decode the encoded
folder name. Keep paths that still exist as directories. Skip `/tmp`,
`/private/tmp`, `os.tmpdir()`, any `node_modules` tree, `.cursor`
trees, `.git/worktrees` metadata dirs, leftover Cursor/cloud
checkout names (`cursor/desktop-…`, `cursor-desktop-…`), isolated
`~/.config/openchamber/chats` descendants, and the exact home folder. Nested
herdr/subagent jsonl are children, not projects. `archive/`
stays off the list. One unreadable folder or jsonl does not drop the
rest. `activeProjectId` / `lastDirectory` are the most recently updated
remaining cwd. `projects: []` after Close Project is not first-install —
do not scan again. This write does not create `{agentDir}/pichamber.json`
and does not flatten `GET /api/session`. List stays directory-scoped.

## Custom provider protocols

Settings → Providers custom add/edit includes an API protocol field matching
official OpenChamber 1.20.0 (`openai-chat`, `openai-responses`,
`anthropic-messages`). The form still writes the official npm adapter on the
OpenCode-shaped payload. `mapOpenCodeProviderToPi` maps that onto Pi
`models.json` `api`:

| Form protocol | npm | Pi `api` |
|---|---|---|
| `openai-chat` | `@ai-sdk/openai-compatible` | `openai-completions` |
| `openai-responses` | `@ai-sdk/openai` | `openai-responses` |
| `anthropic-messages` | `@ai-sdk/anthropic` | `anthropic-messages` |

Do not invent leftover OpenCode plugins or hardcode a provider id.
`GET /api/provider` exposes `api` so Edit prefills the same protocol.
Config-defined customs skip the standalone auth panel; credentials stay on
the custom form. Models still come from Pi at runtime.

## Custom provider context windows and input

Settings → Providers custom-model rows persist Pi `contextWindow`,
`input`, and `reasoning` on that model in `{agentDir}/models.json` (and
project `.pi/models.json`). Save must not strip a stored
`["text", "image"]` or `reasoning: true`. Empty on a known id writes
that id's published window (`grok-4.6` = 500k) and, when the same id is
a known vision / thinking model, `input: ["text", "image"]` and
`reasoning: true`. Lookup uses the official `provider/model` key first,
then the same model id in models.dev, then the published id table. A
live or stored Pi-default `["text"]` is empty, not a user override.
Host startup hydrates already-saved rows for those known ids so an
existing custom proxy does not stay text-only until the next Settings
save. Empty on an unknown id stays omitted — do not invent a window or
capability that pretends to be user-set. Family inference and the UI
200k fallback stay display-only. `toProviderModelRecord` exposes
`limit.context` and composer `capabilities` so modality matches Pi.
Pi reads the stored fields; a missing window becomes its 128k default,
and a missing `input` becomes `["text"]` (images are omitted).

## Built-in xAI catalog and subscription login

`GET /api/provider` (and SDK `GET /provider`) returns
`{ all, default, connected }`. `all` merges `ModelRuntime.getAvailable()`
with `PI_BUILTIN_CATALOG_PROVIDERS` (`xai`) so Add can list xAI before
login. `connected` is provider ids that already have models — a catalog
stub with empty `models` stays off that list. `GET /api/config/providers`
is the live connected list only: it must not keep a model-less xAI stub
in the sidebar, and it must not list a Pi builtin catalog provider
(`getBuiltinProviders()`, including `anthropic`) unless `auth.json` or
user/project `models.json` has that provider. Env-only availability after
Disconnect does not recreate the row. Mock kernel still returns only
`pi-mock`.
`getPiAuthMethods` always reports `xai` as SuperGrok / X Premium OAuth
first, API key second — connected or not.

`POST /api/provider/:id/oauth/authorize` and `/callback` wrap Pi
`xaiOAuth.login` (device-code). The helper is loaded from the bundled
`pi-ai` next to `@earendil-works/pi-coding-agent` (`dist/auth/oauth/xai.js`);
that file is not a public package export. Authorize times out if
`device_code` never arrives. Callback writes `{ type, access, refresh,
expires }` to `{agentDir}/auth.json` through `writePiProviderAuth`. Refresh
uses `xaiOAuth.refresh`, not a copied token exchange. Other provider ids
are 404. No pending authorize is 400. Responses never echo tokens.

Product login is this built-in `/login xai`, not the Feature Plugin
`xai-auth` catalog. Composer `/login` for `xai` points at Settings →
Providers. Feature Plugins `xai` is Usage only.

## Grok Usage (feature-plugin slot)

Gate is Feature Plugins `xai` (`npm:pi-xai-oauth`) installed+enabled.
Chrome follows `{agentDir}/settings.json` `packages` only. Chamber
`enabled` is ignored. Opening Feature Plugins never auto-installs the
package and must not run the plugin `npx` setup (that would change
`defaultProvider`). Do not install `@blockedpath/pi-xai-oauth` alongside
it.

When the slot is on:

- `GET /api/pi/xai-usage` uses the same grok billing REST surface as the
  plugin (not a chat `/xai-usage` turn). It refreshes oauth through Pi
  when `expires` is near or billing returns 401/403, then maps the
  credits envelope (`config.creditUsagePercent`, `currentPeriod.end`,
  `{ val }` cents wrappers, `productUsage`) onto `UsageWindow`. Slot off
  or missing oauth is `{ ok: false, configured: false }` — not empty
  success. Billing or refresh failure is
  `{ ok: false, configured: true, usage: null, error }` and must not
  invent `usedPercent: 0`. The response never includes the access token,
  refresh token, or user id. Do not probe `/v1/user` for usage.
- Leftover `/api/quota/*` stays unregistered.
- `GET /api/command` lists `/xai-usage` before a session exists.

Work Status Usage and the Providers xAI card share that payload. Session
context % / cost stay in the Session block.

## Tool part timing

Live `tool_execution_*` events keep the first `state.time.start` for that
`toolCallId`. Later running updates must not reset start to `now()`.
Completion writes `end` and `duration` (milliseconds). The chat timer
freezes on that duration or `end - start`. Hydrated tool results that
omit times still mark `completed`/`error` so the UI cannot keep counting.

## Session thinking levels

`GET /api/session/:id/thinking` returns `{ thinking, available }` from the
live session: `thinkingLevel` plus `getAvailableThinkingLevels()`.
Hydrate and this GET apply the child's latest jsonl
`thinking_level_change` before reading. A hydrated child often reports
only `off` because `AgentSession.getAvailableThinkingLevels()` reads the
internal model, not jsonl `model_change`. When live `available` is empty
or only `off`, widen from that jsonl model's `ModelRuntime` /
`getSupportedThinkingLevels` (or the model's own `thinkingLevels`).
`PATCH` still clamps an unsupported pick onto that widened list
(`medium`, else the first available). Do not call `setModel` on GET —
real `setModel` appends another `model_change`.
The composer thinking chip renders `available`, not the full seven-level
catalog. A new-session draft with no session id uses models.dev
`reasoning_options` for the selected model id (same slug lookup as
vision). Missing/empty catalog effort hides the control — do not invent
seven levels. Live `available` wins once a session exists. Do not invent
vendor `thinkingLevelMap` from `/v1/models`.

`GET /api/session/:id/model` returns `{ model, providerID, modelID }` from
the live session after applying the latest jsonl `model_change`
(`provider` / `modelId`). A leftover facade `pi`/`pi` pair is not usable
and becomes `{ model: null, providerID: null, modelID: null }`.

`promptAsync` applies `body.variant` or `body.thinking` through
`setSessionThinking` when the value is a known Pi level. An unsupported
pin keeps the session's current thinking. Settings → Projects stores the
pin as official `project.defaultVariant` next to `defaultModel`; map it
through that existing project setting. Do not write it to global
`PATCH /api/pi/defaults`.

## Desktop `ctx.ui`

Live `AgentSession` records call `bindExtensions({ uiContext, mode: "rpc" })`
after create, hydrate, replace, and reload. Title-refresh `reload({ sessionID })`
and process-wide `reload()` use that same bind after `piSession.reload()` (or
factory replace). Attach-only leaves extensions `ui_unavailable`. Print-mode /
unbound sessions stay `ui_unavailable`.

`ExtensionUIContext` mapping:

| `ctx.ui` | Desktop |
|---|---|
| `select` | In-chat option card (single, or multi when `opts.multiple`) |
| `confirm` | Modal confirm / cancel → boolean |
| `input` / `editor` | In-chat text field. Plan **Other** is a `select` option, then `editor` |
| `notify` | Toast via `pi.ui.notify`. Routine Hermes `Session backfill complete` is dropped; `Session backfill failed` / `check failed` still toast |
| `custom` | No TUI factory. Installed Pi `question` is remapped onto `select` + `editor` (see Question tool). Other `custom()` callers get an in-chat editor, not silent `undefined` |
| TUI-only (widgets, terminal input) | No-op (`createNoopUiExtras`) |

The Node-kernel child cannot receive `uiContext` over IPC (`bindExtensions` sends `{ mode: "rpc" }` only). `wrapSession` always installs a local stub: the same IPC proxies for `select` / `confirm` / `input` / `editor` / `notify`, plus `createNoopUiExtras()` for TUI helpers (`setToolsExpanded`, `getToolsExpanded`, `setWidget`, `setStatus`, …). `hasUI` is true because those methods exist; missing noops abort `pi-subagents` before the child gets a turn. Do not invent new parentRequest channels for TUI widgets. Node-child IPC carries the Pi SDK string second argument for `input` (placeholder) and `editor` (prefill, including `""`) as its own field, separate from abort/timeout `opts`. `serializeUiOpts` still serializes AbortSignal as `{ aborted }` only; a string must not go through it.

Answers resolve the waiting promise on that session. Cancel settles **that prompt only** (`undefined` / `false`). It does not abort the Desktop window or the Pi session. Composer **Stop** calls `host.abort()`, which cancels every waiting `ctx.ui` prompt on that session **and** force-publishes `session.idle` even when Pi `abort()` is a no-op (the turn already finished or never emitted `agent_settled`).

## Protocol

Pichamber-owned. Do not use OpenCode `/api/question` or `sdk.question.reply`.

- Events: `pi.ui.asked`, `pi.ui.settled`, `pi.ui.notify`. `asked` fans out a content-free native question push (`question-<promptId>`); `settled` cancels a pending debounce; `notify` does not push.
- `GET /api/pi/ui?session=` — pending prompts. Opening a session hydrates this list into the transcript; fetch failure must not clear local cards. A session with no messages still shows a pending select card (do not replace it with the empty-chat welcome).
- `pi.ui.notify` is the user-visible confirmation for `/plan start` (and for a launch-menu Start). It is a short auto-dismiss toast, not a question card or OK confirm. The settled card title may still say "Status: Off". Routine Hermes `Session backfill complete` does not publish; failed backfill still does.
- `POST /api/pi/ui/:id/reply` `{ sessionID, value }`
- `POST /api/pi/ui/:id/cancel` `{ sessionID }`

`GET /api/question` stays `[]` on Pi.

## Question tool

The installed Pi `question` extension (official example / `@earendil-works` question tool) is TUI-only: it returns "UI not available" unless `ctx.mode === "tui"`, then calls `ctx.ui.custom` with a TUI Editor and an extra `{ label: "Type something.", isOther: true }` option. Desktop stays `mode: "rpc"` and does not run that factory.

After `bindExtensions`, the host replaces that tool's `execute` (`adaptQuestionToolForDesktop` in `question-desktop.js`) so Desktop can answer it:

1. Options present: `ctx.ui.select` with the model options plus a numbered `Type something.` option.
2. No options: `ctx.ui.editor` so an open-ended question still gets an input card.
3. A chosen option returns the official `{ answer, wasCustom: false, index }` result.
4. `Type something.` / `Type something` (and numbered variants) is Other: the in-chat card opens `CustomAnswerTextarea`, then `editor` consumes the stashed text the same way Plan Other does. The host re-adapts the tool after bind and again before each prompt so a late-registered `pi-question-tool` still maps.

`isFreeformOtherOption` in the shared UI matches those Type something labels as well as existing `Other` labels. This is not OpenCode `/api/question`. Plan select-only cards without Other still have no textarea.

While a prompt is pending, the usable card belongs on the asking `question` / `plan_mode_question` tool turn. The bottom dock is only for prompts that are not bound to a visible question-tool part (for example a bare `/plan` launch). After reply or dismiss, do not keep that card under later messages. The answered or cancelled result stays on that turn (`User selected` / `User wrote` / `User cancelled`, plus `details.answer`). Reopening the session hydrates `GET /api/pi/ui` onto the same turn; fetch failure must not clear a local card.

## Plan questions

`plan_mode_question` asks sequential `ctx.ui.select` calls (options + Other), then `editor` for a custom answer. Plugin / slot off means the tool is not loaded, so no cards appear. Those cards appear during a planning turn after Plan is on — not from `/plan start`.

`@narumitw/pi-plan-mode` command vs UI (measured; do not invent a second menu):

| Invocation | Host result |
|---|---|
| `/plan start` | Enter Plan + `ctx.ui.notify`. `GET /api/pi/ui` stays `[]`. Not a question-card probe. |
| bare `/plan` | Launch `ctx.ui.select` (Start / tools / Settings / How it works). Immediate UI proof that bind works. `ask()` only subscribes abort when `addEventListener` is a function (Node-child IPC can pass `{ aborted }` without EventTarget). A new ask cancels earlier pending cards so a late `/plan` does not stack on a confirm. |
| `/plan tools` | Tools `ctx.ui.select`. |

Desktop chrome uses `/plan start` for the Agent \| Plan footer on an already-open
session, including one with history. On a new-session draft, the footer Plan
chip is local intent only; `/plan start` runs after send materializes that
session. Composer `/plan` (listed extension command, empty args) still goes
through `session.command` → `session.prompt("/plan")` so the launch card
still appears, including the first send that materializes a new session
while Feature Plugins are still loading. Do not intercept bare `/plan`
as a toast-only start. When the Plan slot is loaded and off, typed
`/plan` is chat. A 404 is the unknown-command toast, not a leftover
`/plan` bubble.
`@narumitw/pi-plan-mode` `/plan start` is not limited to new chats. A saved
plan still blocks another start. Goal and Plan share `workflow:mutex:v1`.
Busy/retry sessions still 409.

## Session plan status

`GET /api/pi/session/:id/plan` returns
`{ status: off|active|ready|saved|implementing, planMarkdown, title? }`
from the session `plan-mode-state` custom entry (same mapping as
`pi-plan-mode` `formatStatus`). Real `AgentSession` has no
`getPlanModeState()`; the Node child snapshot and host read restore
that entry (and fall back to a live getter only when it is actually
on). An empty getter must not win over jsonl `enabled: true`.
Memory `getEntries()` can be stale after a cold open or `/plan start`;
the host also reads the session jsonl file and prefers a disk
`plan-mode-state` entry when the snapshot omits it. It does not scrape
TUI widgets or read `.opencode/plans`. Fetch
failure is an HTTP error, not an empty `off`.

`POST /api/pi/session/:id/plan` `{ action, model? }`:

| action | Dispatch |
|---|---|
| `start` | `session.prompt("/plan start")`, then refresh the snapshot and re-read plan-mode-state from memory and the session jsonl. If both still say `off`, 500 — do not treat an empty `prompt()` stub as success. Disk `enabled: true` is success even when the snapshot entries are stale. |
| `save` | If a pending plan-ready `ctx.ui.select` is open, reply `Save for later`. Otherwise `session.prompt("/plan save")` — leave Plan when a ready plan exists |
| `implement` | optional `setSessionModel`. If a pending plan-ready `ctx.ui.select` is open, reply `Implement here` (same path as the in-chat card) and do not prompt `/plan implement`. Otherwise `session.prompt("/plan implement")` in this session |
| `exit` | If that plan-ready select is open, reply `Discard plan and exit`. Otherwise `session.prompt("/plan exit")` — discard only |
| `resume` | append saved → ready `plan-mode-state` via `sessionManager.appendCustomEntry`, then `reload({ sessionID })`. Do not IPC `setPlanModeState` (real `AgentSession` has no such method). Do not send `/plan start` (that errors while a saved plan exists) |

`resume` and a missing live `/plan` (reload to attach the command) still
409 while the session is compacting, streaming, or busy. `start` /
`exit` / `save` / `implement` with a live `/plan` only prompt — they
must not 409 on a leftover `isStreaming` or busy flag after a Goal,
shell bind, or ordinary send already finished. A leftover streaming throw
from `session.prompt("/plan start")` still persists Plan-enabled state and
returns `active`, so a just-created session cannot stay `off` for the first
user prompt. Missing live `/plan` is still 404. A saved-plan 409 still
rejects. Successful actions emit `pi.plan.updated`. `start` that leaves
status `off` is a 500. The parent translator also emits `pi.plan.updated`
on successful `plan_mode_complete` `tool_execution_end` with
`details.plan` (same extra-event pattern as `todo.updated`). Do not wait
for a later `/plan` command or a remount GET.
Desktop chrome (Agent \| Plan, View Plan rail, Build) and the hosted/Capacitor
mobile workspace Plan tab are gated on the Pi kernel **and** Feature Plugins
`plan` installed+enabled. Missing/disabled hides those surfaces.
`planModeExperimentalEnabled` does not gate this on Pi.
View Plan stays visible while status is `active` even if
`planMarkdown` is still empty (empty "no plan yet" state). Discard
requires ready/saved/implementing markdown. Build still
requires ready/saved markdown. Desktop localizes known plan-ready
`ctx.ui.select` / `plan_mode_complete` / start-Plan notify chrome.
A ready plan with markdown auto-opens the docked Plan rail
(`openContextPlan`); `/plan start` does not.

## Session todos

`session-todo.js` hosts the live rpiv-todo list for one session. The
gate is Feature Plugins `todo` (`npm:@juicesharp/rpiv-todo`)
installed+enabled. Chrome follows `{agentDir}/settings.json` `packages`
only. Chamber `featurePlugins.todo.enabled` is ignored. Presence of
`todo` tool calls is not the gate.

When the slot is on:

- `GET /api/session/:id/todo` returns the last mapped OpenCode `Todo[]`
  for that session. Slot off returns `[]`. A missing session is 404.
  A hydrate / `getEntries` failure is an HTTP error, not an empty
  success.
- Live updates fire on `tool_execution_end` for tool `todo` with valid
  TaskDetails (`tasks` array + numeric `nextId`). The translator maps
  those tasks and emits SSE `todo.updated` immediately. Do not wait
  for `message_end`.
- Hydrate, reload, compact, and reopen replay the last matching
  `todo` toolResult `details` on that session's branch (same last-write
  wins as `session-plan.js` / `latestCompletionPlan`). Replay failure
  keeps the last good snapshot; it does not write `[]`.
- Child sessions have their own list keyed by session id. Parent Work
  Status does not show child todos.

Mapping: `id` → `String(id)`, `subject` → `content`, `deleted` →
`cancelled`, other statuses pass through, `priority` defaults to
`medium`. Do not draw `blockedBy` / `owner` / `description` on
Work Status rows. Do not hide completed items next turn.

Do not scrape TUI overlay / `ctrl+shift+t` / widget `rpiv-todos`,
read `~/.config/rpiv-todo/config.json`, import the extension process
`Map`, poll, or use leftover OpenCode `todowrite` / `todoread`.
`TOOL_NAME` stays `"todo"`. `/todos` is optional listing, not an
acceptance gate. There is no second install path.

## Slash command dispatch

`POST /api/session/:id/command` (`host.runCommand`) is the command channel on
the Pi kernel. It does **not** use `promptAsync` for unknown names or
extension handlers. `promptAsync` inserts a user bubble first (`body.messageID` when
the client sent one) and is only for chat turns. Pi `message_start`
for that same prompt uses a jsonl id and must not add a second user
row. The translator skips that echo when the facade id is already
set, and also skips a Pi-native user id when the facade id was not
set yet. `applyEventToStore` does not append a non-`msg_*` user
while a client id is already in the store, and reparents an
assistant whose `parentID` is missing onto the last user.

Resolution order:

1. `/reload` — 400. Not a user command and not a chat turn.
   `POST /api/config/reload`, session-scoped `POST /api/session/:id/reload`,
   and `host.reload()` stay.
2. Other host handlers (`compact`, `thinking`, `model`, `login`) — local reply.
   Successful Pi `compaction_end` also emits `session.compacted` (same event
   the pin-to-context runtime already listens for). Abort or failure of
   compact does not. Pin inject then loads each pinned id through
   `GET /api/session/:id/message/:messageID` (live `getMessages` entry, or
   404). The inject `prompt_async` model is a resolved catalog pair, not
   leftover facade `pi`/`pi` — see `context-obligatory/DOCUMENTATION.md`.
3. Live session extension commands — `record.piSession.prompt("/name args")`
   with `expandPromptTemplates` left on (Pi CLI path:
   `expandPromptTemplates` / `_tryExecuteExtensionCommand`). No facade user
   bubble. Live source is `getCommands()` when present, otherwise
   `extensionRunner.getRegisteredCommands()`. Hydrate and `bindExtensions`
   refresh the Desktop node-kernel command snapshot. Feature Plugin
   names (`goal`, `plan`, `run`, `xai-usage`) refresh once, then
   `reload({ sessionID })` once while idle, before 404 — only when that
   slot is installed+enabled or the name is already live. Busy/retry is
   409, not a missing-command 404. A prompt-file overlay of the same
   name still dispatches through `session.prompt`. Empty `getCommands()`
   after bind is not "plugin missing."
4. Markdown prompts from `listPiCommands` (`{agentDir}/prompts` and project
   `.pi/prompts`) — expand `$ARGUMENTS` and send as chat via `promptAsync`.
   `/plan` does not take this path while the Plan slot is on.
5. Other live `getCommands()` entries (`prompt` / `skill`) — same
   `session.prompt` path as the Pi CLI.
6. Unknown name — 404 when this route is called. The composer does not
   POST unknown names here; those fall through to `sendMessage` /
   `promptAsync` as a normal chat turn. `/btw` is a Feature Plugin
   command (slot `btw`, `npm:@narumitw/pi-btw`). When that slot is on,
   the composer owns the fork panel and does not POST this route.
   Without the package, `/btw` is an unknown slash and stays chat.

## Existing Pi agent recognition

Missing `{agentDir}/pichamber.json` is not an explicit disable. Feature
Plugin chrome is on when that slot's source is already in
`{agentDir}/settings.json` `packages`. Chamber
`featurePlugins.<slot>.enabled` is ignored on read and is never written.
A leftover `enabled: false` does not hide chrome while the package is
still listed. Nothing is auto-installed. GET paths do not write
`pichamber.json`. Do not map `{agentDir}/agents/*.md` into `GET /api/agent`.

New-session `model` / thinking use `settings.json` `defaultProvider` +
`defaultModel` / `defaultThinkingLevel` only when `pichamber.json` has no
pin. A project `defaultModel` / `defaultVariant` wins for new chats in
that project. Settings → Extensions packages lists those configured package names
(and project `.pi/settings.json` packages when that file exists), using
`featurePluginSourceIdentity`. Do not walk `{agentDir}/npm/node_modules`.

## Command list

`GET /api/command` (and `/command`) returns the OpenCode command shape:

- builtins + markdown prompts from `listPiCommands` (`compact`, `login`,
  custom prompts from `{agentDir}/prompts` — not `reload`).
- live extension commands from sessions in the request directory
  (`source: "extension"`). When an extension overlays a markdown prompt
  of the same name (`/plan`, `/goal`), keep that prompt's `template`,
  `path`, and `scope`. An empty extension template must not wipe the
  file body. `GET /api/config/commands/:name` reads the prompt file when
  one exists so Settings can load the real template.
- Feature Plugins slash names that must appear before a session exists
  (Goal slot installed+enabled → `/goal`; Plan slot installed+enabled →
  `/plan`; Subagents slot installed+enabled → `/run`; Btw slot
  installed+enabled → `/btw`; Grok Usage slot installed+enabled →
  `/xai-usage`).
  `/goal` copy is "Run a goal to completion". `/plan` copy is "Enter or
  manage Plan mode". `/run` copy is user-facing ("Run a subagent as a
  one-shot workflow"), not plugin jargon. `/btw` is listed as
  `source: "extension"` so the slash menu can show it; the composer
  intercepts the command and forks via the existing session host. It
  does not go through `POST /api/session/:id/command`. Without the
  package, `/btw` is not listed.

Optional `?session=` hydrates that session if needed, then pins the live
command list. Real `AgentSession` has no `getCommands()`; names come from
`extensionRunner.getRegisteredCommands()` (registration `name` plus
`invocationName` when Pi suffixes a duplicate). The Node-child parent
snapshot must serialize that runner list. An empty parent
`getCommands()` cache is not proof the factory is missing. After Feature
Plugins install or `POST /api/pi/extensions/update`, reload every idle
session (`reloadIdleSessions()` with no directory filter). Targeted
`POST /api/session/:id/reload` clears the ensure-once memo so a later
command can refresh again. `reload` is never merged in. Do not emit
`server.connected`.

The OpenCode command shape holds extension entries (`name`, `description`,
`source`, `agent`). A dedicated `GET /api/pi/commands` is not required.

Skills stay `/skill:name` on the composer; they are not merged into this
list as fake OpenCode agents. Chip-owned `/model` and `/thinking` stay off
the list. OpenCode kernel routes are unchanged.

## Desktop `pichamber` and `pichamber_web`

`ensureDirectoryRuntime` still warms cwd-scoped services for the
directory placeholder. User chats do **not** reuse that factory:
`createFacadeSession` / hydrate / attach call `createAgentSession` so
each chat has its own Goal and Plan runtime. Those plugins call
`pi.sendUserMessage` on the factory; a shared factory sent the Goal
preamble and Plan start to another session while this chat only got
the `/goal` bubble. `bindExtensions` still emits `session_start` per
session.

Desktop Electron Pi sessions receive host-owned `defineTool`s as
`customTools` on both `createAgentSession` and `createAgentSessionFromServices`.
The leftover OpenCode plugin names `openchamber` / `openchamber_web` are not
attached on the Pi kernel. Each setting is independent: either, both, or
neither.

`pichamber` (label **Pichamber**) is attached when
`agentControlToolEnabled !== false`. It reuses the shared control-service
allowlist (`OPENCHAMBER_AGENT_TOOL_ACTIONS`): projects, models, sessions,
and scheduled tasks. `schedule.status` stays CLI-only. Session
create/send/fork/list/status/messages go through the in-process host
(`createSession`, `promptAsync`, `forkSession`, `getMessages`, `getStatus`,
`listSessionInfos`) — never HTTP to the local facade, which deadlocks the
same Bun process. `models.list` reads `host.getDefaults()` / the resolved agent dir,
not leftover OpenCode settings. `agent` accepts only the live Pi primary
(`pi`) or omit; leftover OpenCode names are 400. `goal: true` dispatches
Feature Plugins `/goal` via `host.runCommand` when that slot is
installed+enabled, otherwise 400. It does not write leftover Session Goal
metadata.

`pichamber_web` (label **Pichamber Web**) is attached when
`agentWebToolEnabled !== false`. The leftover
OpenCode plugin name `openchamber_web` is not attached on the Pi kernel.

The web tool reuses the existing `browser.*` allowlist and
`openChamberControlService` / browser-control broker. Actions:

| Action | Inputs |
|---|---|
| `browser.open` | `url` (http/https), optional `viewport` (`mobile` / `tablet` / `desktop` / `fill`) |
| `browser.snapshot` | optional `selector` |
| `browser.click` | `selector` or visible `text` |
| `browser.type` | `selector`, `value`, optional `submit` |
| `browser.scroll` | `direction` (`up` / `down` / `top` / `bottom`) or `selector` |
| `browser.back` | none |
| `browser.forward` | none |
| `browser.inspect` | `selector` |
| `browser.capture` | optional `label`; writes under `.openchamber/screenshots/` |
| `browser.resize` | `viewport` |

Budgets stay `browser.open` 45s and 20s for the other actions. No Electron
client claiming `browser=1` returns 503 immediately. Mobile, VS Code, and
hosted web still cannot drive a page.

Settings → Pichamber Tools is leftover OpenCode-kernel chrome. On Pi,
Settings → General shows the Pi agent directory and bundled Pi version
instead. Host tools still attach from persisted flags when those leftover
settings exist. Toggle persist then `host.reloadIdleSessions()` /
`POST /api/pi/sessions/reload-idle`. Do not call leftover OpenCode restart.
A busy session is skipped (409 on a targeted reload) and keeps the previous
tool set until it is idle. Mock kernel sessions get a tool only when a test
or the production getter injects it.

## Session reload

`host.reload({ sessionID })` reloads only that live session. A busy sibling
does not 409. A busy or compacting target still 409s, including a
first-send bind that already marked the session busy. Process-wide
`host.reload()` / `POST /api/config/reload` still refuse with 409 while any
targeted session is compacting. A streaming or stuck-busy turn is aborted and
settled as interrupted (`session.error` plus one `openchamber:notification`
with kind `opencode-restart-interrupted`) so the chat can continue instead of
hanging. Compaction is unchanged.

After `piSession.reload()` (or factory replace), the host calls the same
`bindExtensions({ uiContext, mode: "rpc" })` used on create. Attach-only
leaves extensions `ui_unavailable`.

Reload does not emit `server.connected`. The UI treats that event as a full
re-bootstrap onto a new-session draft.

`host.reloadSessionRecords({ sessionID })` / `POST /api/pi/sessions/reload`
is the sidebar Refresh path. It reloads Pi in place (skills, prompts,
extensions, and model runtime when no live session is busy) **and** re-reads
persisted session records: the merged **active** session list
(`archived: false`, so `archive/` is not scanned) plus messages for the
targeted session (mtime from that session file, not an inclusive list). A busy target is 409 and leaves siblings untouched. Idle
siblings can still refresh; busy siblings are skipped. One unreadable session
file does not remove other complete sessions. This path also does not emit
`server.connected`. Title-refresh `POST /api/session/:id/reload` stays
skills/prompts/extensions only.

## Session hydrate

Attach and sidebar Refresh assign
`record.messages = facadeMessagesFromPiEntries(jsonl entries)`.
The transcript is the full session file, not `getBranch` /
`buildContextEntries`. Compaction and a later leaf still keep earlier
turns on disk; opening the session must render every `type: "message"`
line. `transcriptEntriesForHydrate` reads that file first and falls
back to `getEntries` only when the file is empty. It never uses the
live leaf path.
Walk `type: "message"` entries in order. `thinking` → `reasoning` and
`text` → `text` stay as they are. Assistant `parentID` is the latest
user message in that file, not the jsonl previous-line `parentId`
(that is often a `toolResult`). Chat turns only render assistants
whose `parentID` is the user bubble; a raw jsonl parent drops every
later step of the same send. An assistant `toolCall` plus a later
`toolResult` with the same `toolCallId` become one assistant `type: "tool"`
part (`callID`, `tool`, `state.input`, `state.output`, `state.status`) —
the same shape live SSE already emits in `event-translator.js`.
Live `message_update` `toolcall_start` is `{ contentIndex }` plus optional
`partial`; it does not carry `toolCall`. Do not mint a facade part named
`tool` with a generated call id — that leftover empty Tool row never joins
`tool_execution_*` and sits above the real **Pichamber Web** card. Read
`toolCall` from `partial.content[contentIndex]` or `message.content[contentIndex]`
when present. `toolcall_end.toolCall.id` and `tool_execution_*.toolCallId`
update that same part.
`role: "toolResult"` is never a user message. A Pi `image` block
(`mimeType` + `data`, or a `source` payload) becomes a facade `file` part
(`mime` + `url: data:...`). `promptAsync` keeps those file/image parts on
the user message and forwards Pi-native `{ type: "image", data, mimeType }`
to `session.prompt`. Synthetic text parts with `metadata.pichamberContext`
(or leftover `openchamberContext`) stay on the user bubble as structured
context; other synthetic text (magic-prompt instructions) is sent to Pi
but omitted from the bubble. Those context parts are also remembered on
`pichamber.metadata.userContext` (message id, authored text, structured
parts) via `persistSessionMetadata`. Hydrate reconstructs the cards from
that entry: Pi jsonl only has the concatenated `session.prompt` string, so
do not call `persistFacadeMessages` on a live transcript to rewrite it. Assistant `provider` / `model` / `usage` copy onto
facade `info` as `providerID`, `modelID`, `model`, `tokens`, and `cost`
(the same mapping live SSE uses in `mapPiUsageToOpenCodeTokens`). Missing
usage stays omitted; do not invent numbers or a hardcoded model.
Leftover facade `pi`/`pi` is not a catalog model. When the turn itself has
no usable pair, hydrate and live `message.updated` / `message.part.updated`
stamp the session model (`currentModel` / last `model_change`) or Pi
defaults (`pichamber.json` `model`). Omit the fields when none of those
resolve. Do not write leftover `pi`/`pi`. Cost stays whatever Pi reported.
A finished assistant also gets `time.completed` and `finish: "stop"` —
the same fields live `message_end` writes — so Refresh and a new host
still show copy / save-as-image / pin. `stopReason: "pending"`, empty
streaming stubs, and user messages stay created-only. Do not invent
`completed` for an unfinished assistant. `piMessagesFromFacadeEntry`
writes model/usage back when they already exist so persist and JSONL
export keep them. Do not invent a second session store. Live SSE uses
the same usable-model stamp so a new-session send does not label the
turn `pi`/`pi` when defaults or the session model exist.

Archive is a Pichamber-only flag on the same `pichamber.metadata` custom
entry: `{ archived: ms | 0 }`. `updateSession` writes that value (including
`0` for restore) and moves the jsonl into a sibling `archive/` under the
same cwd session dir. Restore moves it back. `archived: 0` stays in the
active dir. `toPersistedSessionInfo`, hydrate, and sidebar Refresh read
the flag onto `info.time.archived`. `0` is restored, not archived.
Active list (`archived=false` / absent) only calls `SessionManager.list()`
on the active dir — it does not open `archive/` files. `archived=true`
also lists `archive/`. A leftover archived jsonl still in the active dir
is relocated after its tail-scan so the next active list skips it.
List metadata is a tail-scan for the last `pichamber.metadata`; it does
not full-read jsonl again after `SessionManager.list()`. Reuse that list
item's title / firstMessage / timestamps. Placeholder list names
(`New session`, `Pi session`, `(no messages)`) collapse to `New session`
so list, hydrate, and sidebar Refresh agree on one empty-session title.
The first user prompt writes that title through `appendSessionInfo` so
it survives reopen. If jsonl has no `session_info` name, list/hydrate
take the first user line from the file (32KB cap) instead of leaving
the sidebar on Untitled.
After `archived: ms`, stop.
`GET /api/session` and `GET /api/experimental/session` honor `archived`,
`roots`, `limit`, and `cursor` before building the response: omit truthy
archived rows unless `archived=true`; `roots=true` keeps sessions with no
`parentID`; `limit` / `cursor` page by `time.updated` strictly earlier and
set `x-next-cursor` when another page exists. Last-session restore must
not open an archived id. One unreadable session file (active or archive)
does not drop other complete sessions. A failed archive-dir list keeps
active rows.

Clone, fork, and import copy facade messages in memory and persist them
through `SessionManager.appendMessage` as Pi-native `text` / `thinking` /
`toolCall` / `toolResult` / `image` entries so a new host hydrates the
same transcript. JSONL export (`buildSessionJsonl`) writes those same
entries from facade messages so export → import (or a new host) keeps
tool, image, thinking, text, and assistant model/usage when they already
exist. HTML export (`buildSessionHtml`) writes a self-contained offline file
that matches the accepted share-chrome preview: Pichamber cube mark, GitHub +
light/dark toggle (`localStorage` key `pichamber-export-theme`), Pi
coding-agent version (not the Pichamber app version), last usable
model id, user bubbles, thinking as muted unboxed paragraphs, settled
Desktop `ctx.ui` select/confirm questions, tools collapsed by default,
Markdown answers, horizontal 1px left-gutter ticks, and a faded `pichamber` footer. In-file
copy follows the current UI locale. Images are embedded `data:` URLs. Remote
http(s) image URLs are omitted or labeled. One failed block does not empty
the file. It does not create a public share URL. JSONL stays the round-trip /
re-import format.

Clone/fork `parentID` is `{ parentID }` on `pichamber.metadata`. Hydrate,
disk list, and sidebar Refresh read it onto `info.parentID`. Adapter
children persist that same field when the Subagents slot is on so a cold
`GET /api/session` still nests them. `pichamber.subagentRun.parentSessionID`
is only a fallback when the top-level field is missing. List tail-scans
the last metadata; when that latest entry dropped `parentID` (written
once near the start of a long child transcript), a bounded head scan of
the same file still nests. `SessionManager.list()`
stays non-recursive. After that list, the host walks nested
`session.jsonl` under the cwd session dir so an unhydrated parent still
discovers a foreground child that never wrote `status.json`.

## MCP adapter

Settings → MCP and Work Status MCP are gated on the feature-plugin slot
(`installed` and `enabled` for `mcp`, default source `npm:pi-mcp-adapter`).
`enabled` follows `packages`: an adapter already listed in `settings.json`
turns the slot on. Chamber `enabled` is ignored. Opening Feature Plugins
never auto-installs the adapter. Leftover `~/.config/mcp/mcp.json` or
`<cwd>/.mcp.json` files do not reveal those surfaces while the slot is off.

When the slot is on:

- Config CRUD writes adapter files, never `.opencode/opencode.json` or
  `~/.config/opencode`.
- Create: user → `~/.config/mcp/mcp.json`; project → `<cwd>/.mcp.json`.
- Update/delete write the file that already owns that server.
- Enable/disable persist only `disabled` on `<cwd>/.pi/mcp.json`.
- After a write, `reloadIdleSessions(directory)` reloads idle sessions in
  that cwd through `piSession.reload()`. It does not emit `server.connected`.
- `GET /api/mcp` reports the latest `pi-mcp-adapter/status/v1` snapshot when
  a live session has emitted one; otherwise servers from adapter files are
  `cached` or `disabled`. Lazy/`cached` is valid, not a failure.
- Authorize dispatches the live session `/mcp-auth` command. Isolated
  `createMcpAdapter({ config })` in-memory mode is not used. Host-config
  discovery stays off. The `/mcp` TUI panel is not implemented.

## Desktop `ctx.ui`

Every live `AgentSession` is bound with `bindExtensions({ uiContext, mode: "rpc" })`
after create, hydrate, replace, and `piSession.reload()`. The controller lives
in `extension-ui.js` and speaks `pi.ui.asked` / `pi.ui.settled` / `pi.ui.notify`.

- `GET /api/pi/ui?session=` lists pending prompts for that session.
- `POST /api/pi/ui/:id/reply` and `/cancel` resolve the waiting extension
  promise. Confirm uses a desktop dialog; select / input / editor render as
  in-chat cards. Notify is a desktop toast.
- Installed Pi `question` is remapped onto that same select + editor card
  (Type something is Other). `ctx.ui.custom` is not a TUI and is not a
  silent `undefined`. This is not OpenCode `/api/question` or
  `sdk.question.reply`. Pending cards may sit in the bottom dock; settled
  answers render on the asking tool turn.

`@narumitw/pi-goal` can call `ctx.ui.confirm` when replacing an existing goal.

## Composer Goal start

The configured Goal command (default `goal`) is a command-channel start, not
chat:

1. Empty arguments — 400. Bare `/goal` is the TUI manager and Desktop cannot
   draw it.
2. Live extension command missing after snapshot refresh and one idle
   session reload — 404. The Goal slot must be on to take that ladder;
   without the package, missing `/goal` is 404 without reload. Busy is
   409. Do not `promptAsync` the slash as a user bubble.
3. Live command present (including a prompt overlay of the same name, or
   `invocationName` `goal:1` when two factories registered `goal`) —
   `record.piSession.prompt("/<invocation> <objective>")` so
   `registerCommand` runs. Also append a facade user message
   `/goal <objective>` (so the chat shows the user’s goal) and
   title the session from that text when it is still Untitled.

`@narumitw/pi-goal` starts on any idle session, including one with
history. Opening a persisted session hydrates, binds Desktop `ctx.ui`,
then serializes the runner command list onto the parent snapshot. A new
empty session lists `goal` on `GET /api/command?session=` because that
GET hydrates the session and the Goal slot also injects a catalog row.
The composer Goal button may mint a draft session before
`session.command` with `createSession({ activate: false })` only when
there is no current session. An already-open chat (including one whose
welcome still looks empty) must send `/goal` to that id. Do not
switch the open chat onto a minted id until start succeeds; a failed
start stays in the modal on the draft (and must not look like success).
Retry reuses the minted id. Do not require a provider/model for this
command-only start.
Replacing an existing goal still uses `ctx.ui.confirm`. Goal and Plan
cannot both hold the workflow mutex. Desktop refuses Start Goal while
the Plan chip is on, including local draft Plan, and does not mint.
The host also 409s `/goal` while Plan is `active`/`ready`, and
`POST plan start` while a `goal-state` entry is still in-flight, so a
live Plan chat cannot append `/goal`. Session titles skip the Goal
plugin preamble (`Goal mode is active.`) and keep `/goal <objective>`.
The translator does not emit that preamble as a user bubble and does
not take the user-message slot from it. `/goal` binds the facade user
id on the translator before `prompt`, so empty-draft Goal replies stay
parented to `/goal` instead of a hidden preamble. After hydrate, the
live `/goal` user message stays ahead of the Goal-turn assistants and
those messages are restamped so `time.created` sorts `/goal` first
(jsonl must not move it below Goal complete). Disk session names that
are the preamble or `继续` do not replace an objective title. `/goal`
sets in-memory `metadata.pichamber.piGoal.active` before send so the
sidebar can show the target mark, persists it after `prompt`, and
clears `active` on `agent_settled` when `goal-state` is no longer
in-flight. Session load, reload, message refresh, the live session list, and the
disk session list do the same reconcile against `goal-state`: interrupt,
an abandoned empty draft, or a leftover mark after restart must not
keep 🎯. List tail-scans `goal-state` only when the persisted mark still
looks active. `/goal`'s `prompt` returns when the command handler
queues the Goal follow-up, not when Goal complete arrives.

## Subagent children

The Subagents feature-plugin slot (`installed` and `enabled`) is the gate.
`GET /api/pi/feature-plugins` is the existing slot status; this host does not
add a second install path. Opening Feature Plugins or installing
`npm:pi-subagents` does not spawn a reviewer.

When the slot is on:

- `/run` is a command-channel start, not chat. Bare `/run` replies with
  usage (TUI launcher is unsupported on Desktop). A missing live command
  is 404 and is not `promptAsync`'d. `/run <agent> <task>` starts
  `session.prompt("/run …")` without blocking the HTTP response and
  polls for an openable child. If none appears (including a hung scout),
  the host writes an assistant error and idles the parent. Parent
  session id is never treated as the child.
- `GET /api/session` / `listSessionInfos` attaches adapter children and
  includes each attached `record.info` with `parentID` equal to the
  parent Pi jsonl id. The sidebar tree reads that flat list; it does
  not require a prior `/subagent-runs` call and must not send
  `roots=true` (that filter drops `parentID` rows). Child ids are the
  jsonl header ids, not newly minted `ses_*` chats.
- `GET /api/session/:id/subagent-runs` lists this parent's fleet. Live
  `subagent` tool-call input/output (`sessionId` / `childSessionId`) and
  assistant `toolCall` arguments win over leftover adapter `status.json`
  files. Each public run is
  `{ runId, sessionID, toolCallId, name, role, mode, state, title, openable }`.
  `toolCallId` is the parent `subagent` tool call so the transcript card
  can open a child that never wrote `sessionId` on the tool payload
  (async `workflowScript` runs). Collapse the parent `call-*` tool id and
  the adapter workflow `runId` into one fleet row when they share one
  child. A workflow that fans out to several `steps[].sessionFile` values
  keeps one row per child; different `sessionID`s are not the same run.
  Copy `status.json` child `sessionFile`, agent/label, and lifecycle
  onto that row. Workflow top-level `state: complete` does not win over a
  still-running or queued step. `queued` stays queued. Adapter
  `currentTool: contact_supervisor` (interview) is `blocker: "question"`
  so Work Status can show the ask without waiting for `ctx.ui`.
  An async `workflow` launch is `mode: "background"` (Work Status 「后台」)
  — that is the adapter contract, not a missing child. Name the row from
  `steps[].agent` / `runs.run("label", { agent })`, not the generic
  `subagent` fallback. A tool that recorded a child id is
  `openable: true` so Work Status and the transcript card open the same
  writable tab. Scraping a `.jsonl`
  session path from tool text is a length-capped linear scan so listing
  stays cheap on the HTTP thread.
- Management / action-only `subagent` calls (`list`, `status`, `get`,
  `models`, `guide`, `children.list`, `debug` / `debug.run`, and
  `details.mode === "management"`) are not fleet runs. Status and
  `debug.run` toolResults that keep `mode: "single"` and dump
  `Session: {timestamp}_{id}.jsonl` are still management — they do not
  scrape that path into a child. They do not appear in Work Status, do
  not enter `GET /api/session`, and do not mint a facade session or
  child jsonl. `mode: "management"` is never treated as foreground.
  Attach never persists `parentID` onto a top-level project chat
  (`{timestamp}_{id}.jsonl`). A stolen `subagentRun` marker already on
  that file is ignored on list / hydrate so the conversation stays a
  root. Clone/fork `parentID` without that marker is unchanged.
- Terminal adapter files with no child id are dropped (not a pile of
  untitled ghosts). Status-only is only for a still-queued/running/blocked
  run whose id is not ready yet. A finished tool-call without a child is
  not minted into an empty chat just to make the row clickable.
- A run with a child session file is attached as a facade session: stable Pi
  id, `GET /api/session/:id` + `/message`, and `prompt` / steer on that child.
  Attach also hydrates when only `sessionID` exists (`ensureRecord`); it
  does not mint an empty chat. A stale adapter `sessionFile` whose temporary
  child has already been cleaned up is skipped; a usable child id still falls
  back to normal hydration without retrying the missing file. Lookup by id walks nested herdr/subagent
  jsonl (`{parentBasename}/{runId}/run-N/session.jsonl`) and matches the
  header id — those files are not top-level and are often named
  `session.jsonl`. `SessionManager.list()` stays non-recursive. Attach
  persists `pichamber.metadata.parentID`
  on the child jsonl so a new host still nests. An existing live child
  that gains `parentID` emits `session.updated`. Top-level project chats
  never gain adapter `parentID` from attach.
  Attach and child-message refresh skip a full jsonl parse when that file's
  mtime and size are unchanged; a busy child still updates when the file
  changes. Re-attaching an already-live child rereads that file and
  publishes `message.updated` / `message.part.updated` so the side panel
  does not stay on the first Task line. `GET /api/session/:id/message`
  does the same for children and idle parents. A live streaming parent
  keeps the translator as owner. Hydrate keeps the live user-message id
  when disk has the same text under a Pi-native id, so one send is one
  bubble. An empty or shorter hydrate must not replace a longer live
  transcript — the jsonl may not have flushed the current turn yet.
  Follow-ups stay on the child; the parent transcript is unchanged.
- `GET /api/session/:id/children` returns those attached child infos. It is
  not leftover in-memory `parentID` clones.

When the slot is off, adapter children are omitted from `GET /api/session`
and both fleet lists are empty. Fork/clone `parentID` rows stay. Leftover
OpenCode `parentID` children are not a Pi fleet. OpenCode kernel routes
are unchanged. Do not implement `/subagents-fleet` or treat Work Status /
Session Goal / multi-run catalog as the sidebar tree.
