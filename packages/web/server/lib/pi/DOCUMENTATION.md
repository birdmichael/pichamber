# Pi kernel host

In-process Pi session host and OpenCode-shaped HTTP/SSE facade. Product
behavior is documented in `docs/PICHAMBER.md`. This file owns the command
dispatch and reload contracts.

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
6. Unknown name — 404. The slash is not sent as a normal user message.

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

Reload does not emit `server.connected`. The UI treats that event as a full
re-bootstrap onto a new-session draft.
