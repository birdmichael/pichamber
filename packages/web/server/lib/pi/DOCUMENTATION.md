# Pi host and facade

Owning module for the in-process Pi kernel: session host, OpenCode-shaped
HTTP/SSE facade, Desktop `ctx.ui`, command dispatch, and reload. Product
behavior is documented in `docs/PICHAMBER.md`.

## Custom provider context windows

Settings → Providers custom-model rows persist Pi `contextWindow` on that
model in `~/.pi/agent/models.json` (and project `.pi/models.json`). Save
must not strip a user-set or provider-reported window. Empty on a known
id writes that id's published window from the UI table (`grok-4.6` =
500k). Empty on an unknown id stays omitted — do not invent a window that
pretends to be user-set. Family inference and the UI 200k fallback stay
display-only. `toProviderModelRecord` exposes `limit.context` from that
stored value for the composer chip, context panel, and work-status usage.
Pi reads the stored field; a missing one becomes its 128k default.

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
| TUI-only (`custom`, widgets, terminal input) | No-op |

Answers resolve the waiting promise on that session. Cancel settles **that prompt only** (`undefined` / `false`). It does not abort the Desktop window or the Pi session. Composer **Stop** calls `host.abort()`, which cancels every waiting `ctx.ui` prompt on that session **and** force-publishes `session.idle` even when Pi `abort()` is a no-op (the turn already finished or never emitted `agent_settled`).

## Protocol

Pichamber-owned. Do not use OpenCode `/api/question` or `sdk.question.reply`.

- Events: `pi.ui.asked`, `pi.ui.settled`, `pi.ui.notify`
- `GET /api/pi/ui?session=` — pending prompts. Opening a session hydrates this list into the transcript; fetch failure must not clear local cards. A session with no messages still shows a pending select card (do not replace it with the empty-chat welcome).
- `pi.ui.notify` is the user-visible confirmation for `/plan start` (and for a launch-menu Start). It is a short auto-dismiss toast, not a question card or OK confirm. The settled card title may still say "Status: Off".
- `POST /api/pi/ui/:id/reply` `{ sessionID, value }`
- `POST /api/pi/ui/:id/cancel` `{ sessionID }`

`GET /api/question` stays `[]` on Pi.

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
4. Markdown prompts from `listPiCommands` (`~/.pi/agent/prompts` and project
   `.pi/prompts`) — expand `$ARGUMENTS` and send as chat via `promptAsync`.
5. Other live `getCommands()` entries (`prompt` / `skill`) — same
   `session.prompt` path as the Pi CLI.
6. Unknown name — 404 when this route is called. The composer does not
   POST unknown names here; those fall through to `sendMessage` /
   `promptAsync` as a normal chat turn.

## Command list

`GET /api/command` (and `/command`) returns the OpenCode command shape:

- builtins + markdown prompts from `listPiCommands` (`compact`, `login`,
  custom prompts — not `reload`)
- live extension commands from sessions in the request directory
  (`source: "extension"`)
- Feature Plugins slash names that must appear before a session exists
  (Plan slot installed+enabled → `/plan`; Subagents slot
  installed+enabled → `/run`)

Optional `?session=` hydrates that session if needed, then pins the live
`getCommands()` list. After Feature Plugins install, or enable of an already
installed slot, idle sessions reload through `host.reloadIdleSessions()` /
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
same Bun process. `models.list` reads `host.getDefaults()` / `~/.pi/agent`,
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

Settings → Pichamber Tools shows both rows on Pi Desktop (Agent control +
Pichamber Web). Toggle persist then `host.reloadIdleSessions()` /
`POST /api/pi/sessions/reload-idle`. Do not call leftover OpenCode restart.
A busy session is skipped (409 on a targeted reload) and keeps the previous
tool set until it is idle. Mock kernel sessions get a tool only when a test
or the production getter injects it.

## Session reload

`host.reload({ sessionID })` reloads only that live session. A busy sibling
does not 409. Process-wide `host.reload()` / `POST /api/config/reload` still
refuse with 409 while any targeted session is streaming or compacting.

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
item's title / firstMessage / timestamps. After `archived: ms`, stop.
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
exist. HTML export (`buildSessionHtml`) writes a self-contained offline file:
Markdown text, thinking as its own block, tool calls with input/output/error,
and embedded `data:` images. Remote http(s) image URLs are omitted or labeled.
It does not create a public share URL. JSONL stays the round-trip / re-import
format.

Clone/fork `parentID` is `{ parentID }` on `pichamber.metadata`. Hydrate,
disk list, and sidebar Refresh read it onto `info.parentID`.

## MCP adapter

Settings → MCP and Work Status MCP are gated on the feature-plugin slot
(`installed` and `enabled` for `mcp`, default source `npm:pi-mcp-adapter`).
Opening Feature Plugins never auto-installs the adapter. Leftover
`~/.config/mcp/mcp.json` or `<cwd>/.mcp.json` files do not reveal those
surfaces while the slot is off.

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
- This is not OpenCode `/api/question` or `sdk.question.reply`.

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
install/enable because that GET hydrates the session and idle sessions were
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
