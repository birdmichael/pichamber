# Pi host and facade

Owning module for the in-process Pi kernel: session host, OpenCode-shaped
HTTP/SSE facade, Desktop `ctx.ui`, command dispatch, and reload. Product
behavior is documented in `docs/PICHAMBER.md`.

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

Answers resolve the waiting promise on that session. Cancel settles **that prompt only** (`undefined` / `false`). It does not abort the Desktop window or the Pi session.

## Protocol

Pichamber-owned. Do not use OpenCode `/api/question` or `sdk.question.reply`.

- Events: `pi.ui.asked`, `pi.ui.settled`, `pi.ui.notify`
- `GET /api/pi/ui?session=` — pending prompts. Opening a session hydrates this list into the transcript; fetch failure must not clear local cards. A session with no messages still shows a pending select card (do not replace it with the empty-chat welcome).
- `pi.ui.notify` is the user-visible confirmation for `/plan start` (and for a launch-menu Start). It is a toast, not a question card. The settled card title may still say "Status: Off".
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

Desktop chrome uses `/plan start` for the Agent \| Plan footer. Composer `/plan` (listed extension command, empty args) still goes through `session.command` → `session.prompt("/plan")` so the launch card still appears. Do not intercept bare `/plan` as a toast-only start.

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
Desktop chrome (Agent \| Plan, View Plan rail, Build) is gated on the Pi
kernel **and** Feature Plugins `plan` installed+enabled. Missing/disabled
hides those surfaces. `planModeExperimentalEnabled` does not gate this on Pi.

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
  (Plan slot installed+enabled → `/plan`)

Optional `?session=` pins the live session. After `host.reload()` /
`POST /api/session/:id/reload`, the next list read sees whatever the live
session `getCommands()` reports. `reload` is never merged in.

The OpenCode command shape holds extension entries (`name`, `description`,
`source`, `agent`). A dedicated `GET /api/pi/commands` is not required.

Skills stay `/skill:name` on the composer; they are not merged into this
list as fake OpenCode agents. Chip-owned `/model` and `/thinking` stay off
the list. OpenCode kernel routes are unchanged.

## Session reload

`host.reload({ sessionID })` reloads only that live session. A busy sibling
does not 409. Process-wide `host.reload()` / `POST /api/config/reload` still
refuse with 409 while any targeted session is streaming or compacting.

After `piSession.reload()` (or factory replace), the host calls the same
`bindExtensions({ uiContext, mode: "rpc" })` used on create. Attach-only
leaves extensions `ui_unavailable`.

Reload does not emit `server.connected`. The UI treats that event as a full
re-bootstrap onto a new-session draft.

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
