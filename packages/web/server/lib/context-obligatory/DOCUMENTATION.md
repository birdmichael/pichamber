# Context Obligatory Messages

Messages explicitly pinned by the user are stored under
`session.metadata.openchamber.context_obligatory_messages` as `{ id, createdAt,
role }`. The UI uses a fresh-read metadata merge when pinning or unpinning.

The server runtime listens for `session.compacted`. OpenCode already emits
that event. On Pi, a finished `compaction_end` is translated to the same
event (`sessionID` plus `directory`) so slash, UI, and API compact all hit
this path. Abort or failure of compact does not emit `session.compacted`.

It fetches every pinned message by ID (`GET /session/:id/message/:messageID`),
keeps non-empty text parts, sorts them by the stored creation time, and
immediately sends one synthetic user part through `prompt_async`. On Pi that
by-id route reads the live host list (`{ info, parts }`) and 404s when the
id is missing. OpenCode's session runner serializes this with its own
post-compaction continuation. Missing individual messages are skipped without
discarding the remaining context. No pins means no `prompt_async`. Ordinary
idle events perform no work and make no requests.

`prompt_async` needs a catalog model. Leftover Pi assistants often carry
facade placeholders `providerID: "pi"` / `modelID: "pi"`; sending that pair
is `400 Unknown Pi model` and is not a successful inject. Resolve in order:
the leftover assistant when those fields are a real model, else the last
`model_change` part, else any other leftover assistant with a real model,
else `session.model`, else `GET /api/pi/defaults` `resolvedModel` (then
`model`). Do not invent a provider/model. If none of those resolve, skip
`prompt_async` and leave the compaction cursor unwritten.

After a successful send, the runtime merge-writes
`context_obligatory_last_compaction_message_id`. The cursor is the OpenCode
summary message id when one exists, otherwise the `session.compacted` event
id (Pi compact does not mint `summary: true`). That prevents a replayed
compaction event from reinjecting the same summary. The runtime is owned by
the OpenChamber web backend and therefore is not available in extension-only
VS Code mode.
