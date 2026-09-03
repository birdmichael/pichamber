# App data directory

Owning module for the Pichamber app-data tree. Pi agent config at
`~/.pi/agent` is not this directory and is never moved from here.

## Resolution

`resolveAppDataDir` is the only resolver. Order:

1. Non-empty `PICHAMBER_DATA_DIR`
2. Non-empty `OPENCHAMBER_DATA_DIR` (deprecated alias)
3. `{home}/.config/pichamber`

Whitespace-only env values are unset. Relative overrides resolve from cwd.

An override skips migration. Callers must not assemble `~/.config/openchamber`
or `~/.config/pichamber` themselves.

## One-time migration

When the branded default is used, a non-empty `{home}/.config/openchamber` is
copied onto a missing or empty `{home}/.config/pichamber`.

- Missing dest and empty dest are both eligible. A dest that already has
  entries is left alone.
- Copy goes to a sibling staging directory, then a verify of relative paths,
  types, symlink targets, and file sizes, then rename onto dest.
- Source is not removed before verify succeeds. This module leaves source in
  place after a verified copy so leftover OpenChamber data and session cwd
  paths under `~/.config/openchamber/chats/` keep working.
- A failed copy deletes staging and any dest this attempt created. Source
  stays. The process still returns the branded path; the next launch retries
  while dest is still empty.

Do not log file contents or secret names from this tree.

## Managed chats

New isolated chats are `{dataDir}/chats/…`. Session cwd values may still be
`~/.config/openchamber/chats/…` after a copy because Pi session jsonl is not
rewritten. `isManagedChatsPath` dual-reads both path markers.

## Tests

Reset in-process migration attempts with `resetAppDataDirCacheForTests`.
Pass `home`, `env`, and `fs` rather than writing the developer's real
`~/.config` directories.
