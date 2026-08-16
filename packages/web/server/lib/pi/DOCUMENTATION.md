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
- `GET /api/pi/ui?session=` — pending prompts. Fetch failure must not clear local cards.
- `POST /api/pi/ui/:id/reply` `{ sessionID, value }`
- `POST /api/pi/ui/:id/cancel` `{ sessionID }`

`GET /api/question` stays `[]` on Pi.

## Plan questions

`plan_mode_question` asks sequential `ctx.ui.select` calls (options + Other), then `editor` for a custom answer. Plugin / slot off means the tool is not loaded, so no cards appear. v1 does not add `/plan` TUI menus, tool pickers, or a Settings sheet.

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
