# Context Surfaces

## Purpose

`packages/ui/src/lib/surfaces` owns the declarative registry of context panel
surfaces — the desktop workspaces switched by the vertical rail on the right
edge (`components/layout/ContextPanelRail.tsx`) and rendered by
`components/layout/ContextPanel.tsx`. The dedicated mobile shell maps a subset
of those ids onto workspace tabs; see Mobile tabs.

## Model

- A surface maps 1:1 to a `ContextPanelMode` tab mode in `useUIStore`.
- `availability: 'always'` surfaces are always present on the rail.
  `availability: 'has-content'` surfaces (chat, walkthrough) are hidden
  from the rail until a tab of their mode exists, and stay visible for as
  long as one does — they must not disappear while in use. Optional
  `revealedByModes` can also reveal a `has-content` surface when another
  tab mode exists. Walkthrough does not use `revealedByModes`: a Diff or
  PR tab must not grow an empty Walkthrough rail entry. The empty
  walkthrough explainer stays hidden until a walkthrough tab exists or
  the user starts generate from Changes or a pull request. Do not flip
  Walkthrough to `always` or `git-repo` so a blank session can open that
  stub from the rail. Walkthrough still opens through `openContextSurface`
  from a real PR, a diff, or an explicit generate action, and the rail
  then shows it. VS Code and windows below `WALKTHROUGH_MIN_WIDTH` still
  drop Walkthrough even when a tab exists.
  `availability: 'git-repo'` (pull request) appears on a git directory so
  Desktop can open or create a PR from the rail without opening Git first.
  Pass `isGitRepo` only when the directory is known to be a git repo;
  unknown and non-git stay hidden unless a `pr` tab already exists. Do not
  flip `pr` to `always`: a blank or non-git session must not grow an empty
  PR tab. Desktop Git still opens the create-PR form from the Git header
  when the session is a git repo and no PR exists yet. The numbered chip
  still opens an existing PR.
- `defaultWidthFraction` is the panel width as a fraction of the content area,
  used until the user manually resizes that surface (manual widths are stored
  per mode in `useUIStore.contextPanelByDirectory[dir].widthByMode`).
- Rail order is user-reorderable and persisted globally in
  `useUIStore.contextRailOrder`; `sortContextSurfaces` applies it on top of the
  registry's default order and appends any missing surfaces.
- `getVisibleContextRailSurfaces` is the single visibility filter shared by the
  rail and the global surface-switch shortcut (`switch_context_surface` in
  `lib/shortcuts.ts`): it drops the plan surface unless the caller passes
  `planModeEnabled`. On Pi that flag is Feature Plugins `plan` installed+enabled
  **and** live plan markdown (`ready` / `saved` / `implementing`);
  `planModeExperimentalEnabled` must not gate it. On OpenCode it stays the
  experimental plan-mode flag. It also drops the walkthrough on VS Code and
  below `WALKTHROUGH_MIN_WIDTH` even when a walkthrough tab exists, hides
  `has-content` surfaces until a tab of their mode (or a `revealedByModes`
  mode) exists, and hides `git-repo` surfaces unless `isGitRepo` is true or
  a tab of that mode already exists.
  Both consumers use it so the digit shown on a rail badge always maps to the
  same surface the shortcut opens.

## Adding a surface

1. Add a `ContextPanelMode` value in `useUIStore` (type union plus the
   sanitizer whitelist in `sanitizeContextPanelTabs`).
2. Register a descriptor here (icon, label key, availability, optional
   `revealedByModes`, width fraction). `git-repo` callers must pass
   `isGitRepo` into `getVisibleContextRailSurfaces`.
3. Render the mode in `ContextPanel.tsx` (content dispatch, label, icon).
4. Add label/hint i18n keys to every locale dictionary.

No new header buttons: the rail and `openContextSurface` are the only entry
points for opening surfaces directly; deep links from chat/palette go through
the `openContext*` actions in `useUIStore`.

## Invariants

- Opening a surface must never require a control outside the rail, the
  command palette, or an in-content link.
- Desktop Plan docks as a context-panel side rail. Opening Plan leaves chat
  and the composer visible: it must not set `activeMainTab` to `plan`, and it
  must not use the shared per-directory `expanded` overlay (`absolute` full
  area width). Leftover `expanded: true` from Files / Diff / Git is cleared
  when Plan becomes active. Mobile still uses the workspace sheet / `plan`
  main tab.
- When a Pi plan becomes `ready` with markdown, or a pending plan-ready
  `ctx.ui.select` arrives, Desktop calls `openContextPlan` (same dock path).
  `/plan start` and status `active` do not auto-open the rail.
- Multi-instance and session-holding surfaces (file/editor, diff, browser,
  terminal) are keep-alive panes in `ContextPanel.tsx`. Switching these
  surfaces must not reset their state (open tabs, xterm session, scroll
  positions). Chat tab records stay open, but only the active chat iframe is
  mounted while the panel is open. A selected chat restores its state from
  the session stores. A closed panel mounts no chat iframe.
  Browser tabs (and address history) use `resolveBrowserScopeKey`: one set
  per Settings project, plus one shared Chats bucket. A projectless Chats
  draft uses that bucket as soon as the composer opens, before send.
  Files/Git stay on the session directory. Electron cookies stay global.
  Singleton surfaces (git, pr, notes, plan, context) remount on switch. These
  surfaces must restore their state from stores or snapshots.
- Runtime scope: the registry itself is consumed by desktop/web `MainLayout`.
  The dedicated mobile shell does not mount the rail; it maps a subset of
  these surfaces onto `MobileWorkspaceDrawer` tabs (see Mobile tabs).

## Mobile tabs

`apps/MobileWorkspaceDrawer.tsx` is the touch host. Visibility lives in
`apps/mobileWorkspaceTabs.ts` so hosted `mobile.html` and Capacitor share one
list. Each tab implements one Desktop surface id, or is a mobile-only pane:

| Mobile tab | Desktop surface id | When it appears |
|---|---|---|
| `changes` | `git` | Always. Same product name as Desktop Git. |
| `files` | `editor` | Always. |
| `terminal` | `terminal` | Always. PTY stays on the connected server. |
| `notes` | `notes` | Always. Opening a notes plan file is a fullscreen `PlanView` with `targetPath`, not the session Plan tab. |
| `plan` | `plan` | Same gate as the Desktop rail: `resolvePlanRailEnabled` / `usePiPlanChrome()`. On Pi that is Feature Plugins `plan` installed+enabled **and** live status `active` / `ready` / `saved` / `implementing`, including empty “no plan yet”. `/health.planModeExperimentalEnabled` must not gate it. On OpenCode it stays the leftover experimental flag. Renders `PlanView` with no `targetPath` (`PiSessionPlanView` on Pi). |
| `mcp` | — | Same gate as Desktop Settings MCP: `isMcpSettingsAvailable` / Feature Plugin MCP installed+enabled. Hidden on Pi when the slot is off. OpenCode keeps the tab. Not a Desktop rail surface. |

Work Status is not a workspace tab and not the Desktop Context rail
(`CONTEXT_SURFACES` id `context`). The 300px chat-column card stays off
(`useWorkStatusVisibility` / `workStatusPanelMountable`). The header context
ring opens `MobileWorkStatusHost`, which wraps the same Desktop sections
(session, branch, context %, MCP, Subagents). MCP follows
`isWorkStatusSectionAvailable('mcp')` / `isMcpFeaturePluginActive`; Subagents
follows `useFeaturePluginSlotActive('subagents')`. Usage quotas on Pi appear
only when Feature Plugins Grok Usage (`xai`) is installed. Clicking a live child uses `openSubagentChildSession` (`setCurrentSession`
in-place).

Git opens the following Desktop surfaces with the same store actions as the
rail (`openContextSurface` / `openContextDiff`). They are not workspace tabs.
`apps/MobileReviewHost.tsx` hosts the Desktop views:

| Opened from Git | Desktop surface id | Host |
|---|---|---|
| Pull Request button / PR chip | `pr` | `PullRequestView` via `openContextSurface`. |
| File row / pending-changes tap on phone (`< WALKTHROUGH_MIN_WIDTH`) | — | `MobileDiffDetail` + `PierreDiffViewer` inline. Does not open the Desktop Diff overlay. |
| File row / pending-changes tap on tablet (`≥ WALKTHROUGH_MIN_WIDTH`) | `diff` | `DiffView` via `openContextDiff` so the Walkthrough toolbar can appear. |
| Walkthrough button on PR or tablet Diff | `walkthrough` | `WalkthroughView`, tablet-only (`WALKTHROUGH_MIN_WIDTH` / 768). Phone does not unhide the Diff toolbar or force side-by-side. |

Unsupported on mobile (documented, not silently missing):

| Desktop surface id | Why |
|---|---|
| `browser` | Mobile WebView cannot offer the Electron Chromium session (`persist:openchamber-browser`). No reduced honest browser surface exists. |
| `chat` | Split Chat is out of scope on phone. |

Desktop-native privileges (SSH, External Tunnel host, Electron browser session)
stay unsupported on mobile.
