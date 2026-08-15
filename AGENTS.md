# Pichamber Agent Guide

## Purpose

Pichamber is a desktop-first workspace for running, supervising, and reviewing AI coding work. The default kernel is [Pi](https://github.com/earendil-works/pi) (`@earendil-works/pi-coding-agent`), served in-process behind an OpenCode-shaped HTTP/SSE facade.

This file is always-on repository rules and routing. Detailed workflows belong to project skills and module documentation.

Repo: `birdmichael/pichamber`. Owner: birdmichael. Never open a pull request against upstream `openchamber/openchamber`.

## Instruction Order

These steps are mandatory. Before editing, you **MUST**:

1. Follow this root guide.
2. Load every matching project skill and every task-required reference from
   those skills.
3. Read the nearest `DOCUMENTATION.md` and package `README.md` when present.
4. Follow local code and test precedent.

If these sources materially conflict, stop and resolve the conflict instead of silently choosing one.
Do not start editing when a matching skill or required reference has not been
read. Skill loading is a required part of the task, not optional guidance.

## Runtime Boundaries

- `packages/ui`: shared React UI, state, sync, and runtime contracts.
- `packages/web`: in-process Pichamber server, Pi kernel facade, and leftover OpenCode process path.
- `packages/electron`: native desktop shell (the shipping product) and privileged Electron boundary.
- `packages/vscode`: leftover extension host; not the product target for the Pi kernel.
- `packages/mobile`: leftover Capacitor shell; not the product target for the Pi kernel.
- `packages/docs`: product documentation; not a Bun workspace.

The UI still speaks `@opencode-ai/sdk/v2` HTTP/SSE. On the default kernel those routes are implemented by the Pi facade (`packages/web/server/lib/pi`). Pichamber-owned capabilities use `RuntimeAPIs`, `runtimeFetch`, and shared browser/realtime transport helpers.

Electron starts the Pichamber backend in-process, never as a sidecar. Development may load loopback/HMR UI; packaged builds load staged assets through `openchamber-ui://` while the loopback server remains the API backend. Keep domain backends in web/runtime modules unless behavior is inherently native.

Pi config and auth live in `~/.pi/agent` (`auth.json`, `models.json`, `pichamber.json`, `AGENTS.md`, `skills/`, `prompts/`). Project skills live under `.agents/skills` and `.pi/skills`. Project commands/prompts live under `.pi/prompts`. Do not treat `.opencode` as the skills/commands location.

`OPENCHAMBER_KERNEL` defaults to `pi`. Set `OPENCHAMBER_KERNEL=opencode` only to restore the leftover OpenCode process path. Do not mock Pi for product behavior.

Shared contracts must define intentional behavior for every applicable runtime: web, desktop, VS Code, hosted mobile, and Capacitor mobile.

## Always-On Constraints

- Work only in `birdmichael/pichamber`. Do not PR or push upstream `openchamber/openchamber`.
- Do not run git or GitHub commands unless the user explicitly asks.
- Do not add dependencies unless explicitly requested.
- Never add or log secrets, bearer tokens, pairing credentials, or sensitive user data. Do not print API keys from `~/.pi/agent/auth.json`.
- Keep changes minimal and preserve unrelated worktree changes.
- Enforce security and correctness in core/runtime logic, not only UI visibility or prompts.
- Keep entrypoints and bridges thin; place domain logic in focused owning modules.
- Update owning documentation when module ownership, contracts, or invariants change.
- Use the real Pi model/provider already configured in `~/.pi/agent`. Do not invent a second provider.

## Correctness Invariants

- Prefer authoritative state over heuristics.
- Derive live activity from live channels, not persisted history.
- Scope temporary fallbacks narrowly and clear them when authoritative state arrives.
- Never let fetch failure masquerade as authoritative empty success.
- Make partial results, rollback, cleanup, and stale-data behavior explicit.
- One failed entity must not erase or block unrelated complete entities.
- Runtime-specific differences must be intentional and visible in code.

## Documentation Discovery

Before changing a module, search for the nearest `DOCUMENTATION.md`; before package-level work, read its `README.md`. Discover docs dynamically under `packages/**/DOCUMENTATION.md` rather than relying on a static exhaustive map.

High-value anchors:

- Pi kernel: `docs/PICHAMBER.md`
- Sync: `packages/ui/src/sync/DOCUMENTATION.md`
- Stores: `packages/ui/src/stores/DOCUMENTATION.md`
- CLI: `packages/web/bin/lib/DOCUMENTATION.md`
- Performance measurement tooling: `scripts/perf/DOCUMENTATION.md`
- VS Code runtime: `packages/vscode/src/DOCUMENTATION.md`
- Electron: `packages/electron/README.md`
- Mobile: `packages/mobile/README.md`

## Project Skills

Project skills live under `.agents/skills/*/SKILL.md`. You **MUST** load every
skill matching the character of the change before editing; multiple skills may
apply, including companion skills required by another skill. Read every
task-required reference named by those skills. Skills are canonical for their
detailed workflows and checklists. Treating this table as optional advice is a
process violation.

| Trigger | Required skill |
|---|---|
| Source/dependency changes, exports or package contracts, build/generated assets, or module ownership | `openchamber-change-discipline` |
| CLI commands, prompts, terminal output, non-TTY, `--quiet`, or `--json` behavior | `clack-cli-patterns` |
| Shared UI data access, Pi facade or leftover OpenCode routes, `RuntimeAPIs`, runtime auth/URLs, bridges, or runtime switching | `ui-api-decoupling` |
| Electron main/preload, IPC, native UI, updater, deep links, SSH/tunnels, packaging, or child processes | `desktop-shell` |
| Session sync, bootstrap/reconnect, reducers, polling, optimistic state, queues, live status, reconciliation, or directory-scoped caches | `sync-state-invariants` |
| Render/store/event hot paths, large lists, caches/indexes, or reported lag, freezes, CPU/memory, startup, or performance regressions | `performance-engineering` |
| WebSocket, SSE, streaming transport, runtime transport internals, or private relay | `relay-transport` |
| UI components, styling, colors, buttons, or icons | `theme-system` |
| User-facing or accessible UI text, labels, aria, toasts, dialogs, or navigation copy | `locale-ui-patterns` |
| Settings UI, settings dialogs, configuration surfaces, or settings search | `settings-ui-patterns` |
| Sortable or drag-to-reorder behavior, especially `@dnd-kit` and touch/wrapping layouts | `drag-to-reorder` |
| iOS Simulator build, launch, preview, gestures, or `serve-sim` control | `serve-sim` |
| Drafting or updating user-facing CHANGELOG entries for the `[Unreleased]` section (main app or VS Code extension) | `changelog-authoring` |
| Creating or editing skills, `AGENTS.md`, or docs reached through agent instructions/context pointers | `writing-for-agents` |

Pure code-reading or explanation does not require implementation skills unless needed to interpret a specialized subsystem.

### Skill Ownership

Keep each cross-cutting rule with one canonical owner; companion skills add only domain-specific consequences and a pointer to that owner.

| Concern | Canonical skill |
|---|---|
| Change scope, abstraction discipline, and validation risk | `openchamber-change-discipline` |
| State authority, reconciliation, optimistic state, and lifecycle correctness | `sync-state-invariants` |
| Measurement, hot-path cost, caching performance, and optimization evidence | `performance-engineering` |
| Shared UI API and runtime boundaries | `ui-api-decoupling` |
| WebSocket/SSE and private relay mechanics | `relay-transport` |
| Electron native ownership and privilege boundary | `desktop-shell` |
| UI tokens, primitives, icons, and animation styling | `theme-system` |
| Settings composition and search behavior | `settings-ui-patterns` |
| User-facing text and localization | `locale-ui-patterns` |
| Agent-facing document structure and context pointers | `writing-for-agents` |

Before adding guidance to a skill, identify its canonical owner. If another skill owns the rule, add a precise companion pointer and only the local consequence; do not copy the rule.

## Validation

- Use `package.json` scripts as the command source of truth.
- Prefer focused tests and package-scoped type-check/lint for executable source changes.
- Use workspace-wide checks for cross-workspace contracts, root tooling, dependencies, or shared generated assets.
- Run `bun run dead-code` when source files are added/deleted/renamed or exports, types, entrypoints, or import shape change; inspect its report because it is non-blocking.
- Do not assume TypeScript/lint covers server JS, CLI JS, Electron helpers, or native behavior; run focused tests, syntax checks, builds, or runtime validation for the touched surface.
- For docs-only or isolated config changes, run the narrowest relevant validation.
- Report exactly what was and was not validated. Static checks alone do not prove runtime, relay, performance, or platform correctness.

## Pull Request Handoff

Before creating or updating a pull request, read `CONTRIBUTING.md` and
`.github/PULL_REQUEST_TEMPLATE.md`. Complete the template with concrete,
current evidence for the final PR HEAD; do not make the reviewer reconstruct
intent, affected surfaces, applicable guidance, validation, visual behavior,
or failure and rollback considerations from the diff alone.

Open PRs only on `birdmichael/pichamber`. Never target upstream `openchamber/openchamber`.
