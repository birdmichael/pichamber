# Pi host and facade

Owning module for the in-process Pi kernel: session host, OpenCode-shaped
HTTP/SSE facade, Desktop `ctx.ui`, command dispatch, and reload. Product
behavior is documented in `docs/PICHAMBER.md`.

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
`GET /api/pi/upgrade-status` compares the installed
`@earendil-works/pi-coding-agent` with npm and returns
`upgrade.supported: false` (`reason: "bundled"`).

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

## Session thinking levels

`GET /api/session/:id/thinking` returns `{ thinking, available }` from the
live session: `thinkingLevel` plus `getAvailableThinkingLevels()`.
`PATCH` still clamps an unsupported pick onto that list (`medium`, else
the first available). The composer thinking chip renders `available`,
not the full seven-level catalog. A new-session draft with no session id
uses models.dev `reasoning_options` for the selected model id (same
slug lookup as vision). Missing/empty catalog effort hides the control —
do not invent seven levels. Live `available` wins once a session exists.
Do not invent vendor `thinkingLevelMap` from `/v1/models`.

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
| `notify` | Toast via `pi.ui.notify` |
| `custom` | No TUI factory. Installed Pi `question` is remapped onto `select` + `editor` (see Question tool). Other `custom()` callers get an in-chat editor, not silent `undefined` |
| TUI-only (widgets, terminal input) | No-op |

Answers resolve the waiting promise on that session. Cancel settles **that prompt only** (`undefined` / `false`). It does not abort the Desktop window or the Pi session. Composer **Stop** calls `host.abort()`, which cancels every waiting `ctx.ui` prompt on that session **and** force-publishes `session.idle` even when Pi `abort()` is a no-op (the turn already finished or never emitted `agent_settled`).

## Protocol

Pichamber-owned. Do not use OpenCode `/api/question` or `sdk.question.reply`.

- Events: `pi.ui.asked`, `pi.ui.settled`, `pi.ui.notify`
- `GET /api/pi/ui?session=` — pending prompts. Opening a session hydrates this list into the transcript; fetch failure must not clear local cards. A session with no messages still shows a pending select card (do not replace it with the empty-chat welcome).
- `pi.ui.notify` is the user-visible confirmation for `/plan start` (and for a launch-menu Start). It is a short auto-dismiss toast, not a question card or OK confirm. The settled card title may still say "Status: Off".
- `POST /api/pi/ui/:id/reply` `{ sessionID, value }`
- `POST /api/pi/ui/:id/cancel` `{ sessionID }`

`GET /api/question` stays `[]` on Pi.

## Question tool

The installed Pi `question` extension (official example / `@earendil-works` question tool) is TUI-only: it returns "UI not available" unless `ctx.mode === "tui"`, then calls `ctx.ui.custom` with a TUI Editor and an extra `{ label: "Type something.", isOther: true }` option. Desktop stays `mode: "rpc"` and does not run that factory.

After `bindExtensions`, the host replaces that tool's `execute` (`adaptQuestionToolForDesktop` in `question-desktop.js`) so Desktop can answer it:

1. `ctx.ui.select` with the model options plus a numbered `Type something.` option.
2. A chosen option returns the official `{ answer, wasCustom: false, index }` result.
3. `Type something.` / `Type something` (and numbered variants) is Other: the in-chat card opens `CustomAnswerTextarea`, then `editor` consumes the stashed text the same way Plan Other does.

`isFreeformOtherOption` in the shared UI matches those Type something labels as well as existing `Other` labels. This is not OpenCode `/api/question`. Plan select-only cards without Other still have no textarea.

## Plan questions

`plan_mode_question` asks sequential `ctx.ui.select` calls (options + Other), then `editor` for a custom answer. Plugin / slot off means the tool is not loaded, so no cards appear. Those cards appear during a planning turn after Plan is on — not from `/plan start`.

`@narumitw/pi-plan-mode` command vs UI (measured; do not invent a second menu):

| Invocation | Host result |
|---|---|
| `/plan start` | Enter Plan + `ctx.ui.notify`. `GET /api/pi/ui` stays `[]`. Not a question-card probe. |
| bare `/plan` | Launch `ctx.ui.select` (Start / tools / Settings / How it works). Immediate UI proof that bind works. |
| `/plan tools` | Tools `ctx.ui.select`. |

Desktop chrome uses `/plan start` for the Agent \| Plan footer on an already-open
session. On a new-session draft, the footer Plan chip is local intent only;
`/plan start` runs after send materializes that session. Composer `/plan` (listed extension command, empty args) still goes through `session.command` → `session.prompt("/plan")` so the launch card still appears. Do not intercept bare `/plan` as a toast-only start.

## Session plan status

`GET /api/pi/session/:id/plan` returns
`{ status: off|active|ready|saved|implementing, planMarkdown, title? }`
from the live `plan-mode-state` custom entry (same mapping as
`pi-plan-mode` `formatStatus`). It does not scrape TUI widgets or read
`.opencode/plans`. Fetch failure is an HTTP error, not an empty `off`.

`POST /api/pi/session/:id/plan` `{ action, model? }`:

| action | Dispatch |
|---|---|
| `start` | `session.prompt("/plan start")` |
| `save` | `session.prompt("/plan save")` — leave Plan when a ready plan exists |
| `implement` | optional `setSessionModel`, then `session.prompt("/plan implement")` in this session |
| `exit` | `session.prompt("/plan exit")` — discard only |
| `resume` | rewrite saved → ready `plan-mode-state`, then `reload({ sessionID })`. Do not send `/plan start` (that errors while a saved plan exists) |

Busy/retry sessions return 409. Successful actions emit `pi.plan.updated`.
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

## Slash command dispatch

`POST /api/session/:id/command` (`host.runCommand`) is the command channel on
the Pi kernel. It does **not** use `promptAsync` for unknown names or
extension handlers. `promptAsync` inserts a user bubble first and is only
for chat turns.

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
   `extensionRunner.getRegisteredCommands()`.
4. Markdown prompts from `listPiCommands` (`{agentDir}/prompts` and project
   `.pi/prompts`) — expand `$ARGUMENTS` and send as chat via `promptAsync`.
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
  (`source: "extension"`)
- Feature Plugins slash names that must appear before a session exists
  (Plan slot installed+enabled → `/plan`; Subagents slot
  installed+enabled → `/run`; Btw slot installed+enabled → `/btw`).
  `/run` copy is user-facing ("Run a subagent as a one-shot workflow"),
  not plugin jargon. `/btw` is listed as `source: "extension"` so the
  slash menu can show it; the composer intercepts the command and forks
  via the existing session host. It does not go through
  `POST /api/session/:id/command`. Without the package, `/btw` is not
  listed.

Optional `?session=` hydrates that session if needed, then pins the live
`getCommands()` list. After Feature Plugins install, idle sessions reload
through `host.reloadIdleSessions()` /
`POST /api/session/:id/reload` / `piSession.reload()`. The next list read
sees whatever the live session `getCommands()` reports. `reload` is never
merged in. Do not emit `server.connected`.

The OpenCode command shape holds extension entries (`name`, `description`,
`source`, `agent`). A dedicated `GET /api/pi/commands` is not required.

Skills stay `/skill:name` on the composer; they are not merged into this
list as fake OpenCode agents. Chip-owned `/model` and `/thinking` stay off
the list. OpenCode kernel routes are unchanged.

## Desktop `pichamber` and `pichamber_web`

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
Settings → General shows the Pi agent directory and update notifications
instead. Host tools still attach from persisted flags when those leftover
settings exist. Toggle persist then `host.reloadIdleSessions()` /
`POST /api/pi/sessions/reload-idle`. Do not call leftover OpenCode restart.
A busy session is skipped (409 on a targeted reload) and keeps the previous
tool set until it is idle. Mock kernel sessions get a tool only when a test
or the production getter injects it.

## Session reload

`host.reload({ sessionID })` reloads only that live session. A busy sibling
does not 409. A busy or compacting target still 409s. Process-wide
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
Walk `type: "message"` entries in order. `thinking` → `reasoning` and
`text` → `text` stay as they are. An assistant `toolCall` plus a later
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
to `session.prompt`. Assistant `provider` / `model` / `usage` copy onto
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
disk list, and sidebar Refresh read it onto `info.parentID`.

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
  `sdk.question.reply`.

`@narumitw/pi-goal` can call `ctx.ui.confirm` when replacing an existing goal.

## Composer Goal start

The configured Goal command (default `goal`) is a command-channel start, not
chat:

1. Empty arguments — 400. Bare `/goal` is the TUI manager and Desktop cannot
   draw it.
2. Live extension command missing — 404. Do not `promptAsync` the slash as a
   user bubble.
3. Live extension command present — `record.piSession.prompt("/goal <objective>")`
   so `registerCommand` runs.

A new empty session lists `goal` on `GET /api/command?session=` after
install because that GET hydrates the session and idle sessions were
reloaded. The composer Goal button may mint a draft session before
`session.command`. Start failures stay in the modal. Do not require a
provider/model for this command-only start.

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
- `GET /api/session/:id/subagent-runs` lists this parent's fleet. Live
  `subagent` tool-call input/output (`sessionId` / `childSessionId`) and
  assistant `toolCall` arguments win over leftover adapter `status.json`
  files. Each public run is
  `{ runId, sessionID, name, role, mode, state, title, openable }`.
  A tool that recorded a child id is `openable: true` so Work Status and
  the transcript card open the same writable tab. Scraping a `.jsonl`
  session path from tool text is a length-capped linear scan so listing
  stays cheap on the HTTP thread.
- Management / action-only `subagent` calls (`list`, `status`, `get`,
  `models`, `guide`, `children.list`, and `details.mode === "management"`)
  are not fleet runs. They do not appear in Work Status and do not mint a
  facade session or child jsonl. `mode: "management"` is never treated as
  foreground.
- Terminal adapter files with no child id are dropped (not a pile of
  untitled ghosts). Status-only is only for a still-queued/running/blocked
  run whose id is not ready yet. A finished tool-call without a child is
  not minted into an empty chat just to make the row clickable.
- A run with a child session file is attached as a facade session: stable Pi
  id, `GET /api/session/:id` + `/message`, and `prompt` / steer on that child.
  Follow-ups stay on the child; the parent transcript is unchanged.
- `GET /api/session/:id/children` returns those attached child infos. It is
  not leftover in-memory `parentID` clones.

When the slot is off, both lists are empty. Leftover OpenCode `parentID`
children are not a Pi fleet. OpenCode kernel routes are unchanged.
