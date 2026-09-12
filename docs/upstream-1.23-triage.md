# Pichamber ← OpenChamber v1.22.0 → v1.23.1 triage

**Date:** 2026-09-12 (Asia/Shanghai)  
**Pichamber base:** `origin/main` @ `169ec4e` (worktree: `/tmp/pichamber-port-defer-rest-*`; this PR branch)
**Upstream ref:** `openchamber/openchamber` tags `v1.23.0` / `v1.23.1` (local read-only clone: `~/Documents/Code/Other/openchamber-ref`)  
**Product scope:** macOS Desktop Electron + Pi kernel. Adapt ideas; do not blind-cherry-pick OpenCode-only paths.

## Summary counts

| Verdict | Count (release-note items + HP checklist) |
|---------|-------------------------------------------|
| PORT | 28 |
| SKIP | 24 |
| ALREADY | 18 |

High-priority checklist (user list) mapped below; full release-note coverage follows.

## High-priority checklist

| # | Upstream item | Verdict | Evidence in Pichamber | Notes |
|---|---------------|---------|----------------------|-------|
| 1 | Git hunk stage/unstage/discard (#3443) | **PORTED** | Server `applyHunk` + `POST /api/git/apply-hunk` + `gitApiHttp.applyGitHunk` exist; **no** `HunkActions.tsx`; `DiffView`/`PierreDiffViewer` lack `hunkActions` wiring | CHANGELOG already mentions hunks via `git apply` but UI controls are missing — port OC `HunkActions.tsx` + DiffView/Pierre wiring |
| 2 | PR diff review in Changes | **PORTED** | Has `PullRequestView` / create PR; **missing** `PullRequestComparisonSelector`, `usePullRequestComparison`, `pullRequestDiff.ts`, `pullRequestSnapshotCache.ts`, `usePullRequestSelectionStore` | Desktop+Pi relevant |
| 3 | Session AI rename | **PORTED** | No `SessionAiRenameMenuItem` / `use-session-ai-rename`; `session-assist` is recap/suggestion only | Adapt small-model/Pi title generation |
| 3b | Enter saves rename | **ALREADY** | `SessionNodeItem.tsx` rename form: `key === 'Enter'` → `handleSaveEdit` | |
| 4 | Archived-only retention + cascade-safe | **PORTED** | Has `sessionRetentionAction` / auto-delete; **missing** `sessionRetentionOnlyArchived` + entire `sync/session-retention.ts` | Port OC retention module + setting |
| 5 | Attachments inside composer + non-image paste cite | **ALREADY** (mostly) | `LinkedReferenceRow` in composer; `createPastedContextFile`; drop handlers in `ChatInput` | Spot-check non-image file cite parity; glass/recap visual-align PORTED separately |
| 6a | Queued message preview/collapse | **PORTED** | PC `QueuedMessageChips` still uses first-line truncate; no collapse/`getQueuedMessagePreview` | Diff vs OC shows collapse + annotation preview |
| 6b | Turn changed-files accuracy | **PORTED** | `showTurnChangedFiles` / `TurnChangedFilesDropdown` exist; verify direct-edit filter + collapse-after-4 vs OC | Likely partial — confirm during port |
| 6c | Reasoning/bash auto-follow | **PORTED** | No general reasoning/bash follow fix beyond BTW `stickToBottom` | Port OC follow-scroll behavior |
| 6d | Scroll while older history loads | **ALREADY** | Both have `historyLoading` in timeline controller | Diff for preserve-scroll measure; verify before port |
| 7 | Slash commands across project switch | **PORTED** | Slash helpers exist; OC 1.23.1 fix not present as dedicated preserve logic | Verify command cache keying during port |
| 8a | Large text without truncation | **PORTED** | `FilesView.tsx` `MAX_VIEW_CHARS = 200_000` still truncates; OC removed limit | |
| 8b | Restore preview scroll/cursor | **PORTED** | Missing `useFilePreviewScrollPosition.ts` | |
| 9a | Worktrees: settings after checkout | **PORTED** | Missing OC worktree checkout gate (`Timed out waiting for worktree checkout` / readiness test) | Adapt to Pi init, not OpenCode proxy blindly |
| 9b | Worktrees: sidebar topology refresh | **PORTED** | Missing `worktreeTopologyRefresh.ts` / `worktree-changed` event handling | |
| 10 | Projects: deep nested path filename bounds | **ALREADY** | `projectConfigFileStemOf` / `path_sha256_` in `project-id.js` | |
| 11a | Scheduled: runNow while paused | **PORTED** | `runTask` still `if (!task \|\| !task.enabled)` for all reasons; OC allows `reason === 'manual'` | Small fix |
| 11b | Scheduled: one project fail isolation | **PORTED** | `syncAllProjects` awaits `syncProject` with no per-project try/catch | Small fix |
| 12a | Terminal: right-click copy/paste | **PORTED** | PC `TerminalViewport.tsx` has no `ContextMenu` copy/paste | Adapt to PC terminal stack (file larger/different than OC ghostty) |
| 12b | Terminal: macOS Option word editing | **PORTED** | No `macOptionIsMeta` / Option-word handling found | Adapt to PC terminal/PTY |
| 13a | Sidebar width preserve | **ALREADY** | `sidebarWidth` persisted in `useUIStore` + Sidebar resize | |
| 13b | Interface scale | **PORTED** | ThemeProvider zoom → `fontSize` root rem scale; Electron Zoom menu; Header 88px traffic lights (PR #755) | Desktop zoom acts on chat/panels; terminal/editor when focused |
| 14 | MCP auto-reconnect removal | **SKIP** | Pi MCP stack (`pi/mcp-config`, `useMcpStore`); OC change targets OpenCode reconnect plugin | N/A unless PC still ships OC reconnect plugin |
| 15a | Collapsible Markdown disclosures | **PORTED** | OC `detailsExtension` in `markdownCore.ts` + decorate icons; PC markdownCore lacks disclosure tokenizer | |
| 15b | Turn stats in Work Status | **PORTED** | Missing `WorkStatusTelemetrySection.tsx` / `telemetry.ts` | KEEP Providers/Usage-follows-provider |

## v1.23.1 release notes

| Upstream item | Verdict | Evidence | Notes |
|---------------|---------|----------|-------|
| Diff review: PR in Changes | PORT | see HP#2 | |
| Sessions: AI rename | PORT | see HP#3 | |
| Retention: archived-only | PORT | see HP#4 | |
| Chat: paste/drop non-image cite | ALREADY | see HP#5 | |
| Chat visual refinements / glass composer | **PORTED** (visual-align) | Floating/`oc-glass-composer` + glass popups; PC features retained | Relative visual parity with OC 1.23; no OC Usage/Revert/Share |
| Attachments inside message box; queue collapsed | PORT (queue) / ALREADY (attachments) | see HP#5/#6a | |
| Recaps substance / quiet suggestions | **PORTED** | session-assist prompt + SessionRecapNote vanish-in-place (Batch B) | PR #756 |
| Markdown exports quotes/comments | **PORTED** | `formatMessageText` in exportSession (Batch B) | PR #756 |
| Pause hidden panel background work | **PORTED** | FilesView `visible`; Walkthrough `isOpen &&`; Terminal already gated (PR #755) | #755 |
| Inline code theme colors | **PORT** | Check markdown theme vars vs OC | Small |
| Mobile workspace dirty dot | **SKIP** | Capacitor-mobile-only unless shared | |
| Remove non-git changed-files dropdown | **PORT** | Verify `TurnChangedFilesDropdown` gating | |
| Default model/agent/thinking survive restarts | **ALREADY** | `settingsDefaultModel/Agent` + ModelControls thinking; ModelPickerList `React.memo`; OC #3422 sidecar reconcile N/A for Pi | pickers already memoized |
| Model favorites first-change save | **PORTED** | modelPrefsAutoSave flush on first change + isApplyingServerSettings (Batch C) | PR #757 |
| Scroll place while history loads; composer growth | DEFER/verify | HP#6d | |
| Reasoning/shell auto-follow | PORT | HP#6c | |
| Turn file lists direct edits + collapse@4 | PORT | HP#6b | |
| Queue quote/comment preview | PORT | HP#6a | |
| Slash commands across project switch | PORT | HP#7 | |
| Recaps disappear without jump | **PORTED** | SessionRecapNote vanish-in-place note/layout (Batch B) | PR #756 |
| Large text files full edit | PORT | HP#8a | |
| Retention cascade-safe | PORT | HP#4 | |
| Enter saves rename | ALREADY | HP#3b | |
| Worktree settings after checkout | PORT | HP#9a | |
| Worktree sidebar topology refresh | PORT | HP#9b | |
| Deep nested project paths | ALREADY | HP#10 | |
| Scheduled: project fail isolation | PORT | HP#11b | |
| Scheduled: runNow while paused | PORT | HP#11a | |
| Terminal right-click copy/paste | PORT | HP#12a | |
| Terminal Option word editing | PORT | HP#12b | |
| Attach terminal selection → focus composer | **PORT** | Verify focus handoff | |
| Cmd/Ctrl+number shortcuts while typing in chat | **PORT** | Verify composer key routing | |
| AppImage OpenCode path after update | **SKIP** | Product rule | |
| Session tab title fade on hover | **ALREADY** | `.session-tab-title` mask CSS | |
| MCP remove auto-reconnect | SKIP | HP#14 | |
| Electron → 43.7.0 | **PORT** | PC `^43.3.0` vs OC `^43.7.0` | Bump carefully; Desktop verify |

## v1.23.0 release notes

| Upstream item | Verdict | Evidence | Notes |
|---------------|---------|----------|-------|
| Git per-hunk actions | PORT | HP#1 | |
| Turn stats in work status | PORT | HP#15b | |
| Repo-shared project actions/setup/drafts | **PORT** (large) | Missing `project-setup.js` shared-repo flow | Defer if too large; trust prompts needed |
| Plans in repository / folder pointer | **DEFER** | Plans exist; repo-folder mode TBD | |
| Shared commit selection Changes↔Walkthrough | **PORT** | Check selection store parity | |
| Mobile branch/commit compare | SKIP | mobile-only unless shared Changes | |
| Mobile settings manage snippets/agents/… | SKIP | mobile-only | |
| Mobile + start session in project root | SKIP | mobile-only | |
| New-session project search | **ALREADY** | `DraftTargetSelectors` `searchProjects` | verified |
| Paste full session ID search | **PORTED** | exact `ses_` match in sidebar/archive | this PR |
| Collapsible Markdown sections | PORT | HP#15a | |
| Usage: ClinePass | **SKIP** | OpenCode-only usage provider | |
| Usage: Charm Hyper | **SKIP** | OpenCode-only usage provider | |
| Always show scrollbars | **PORTED** | `alwaysShowScrollbars` device pref + OverlayScrollbar alwaysVisible/hover (PR #755) | #755 |
| Activity collapse summary | **ALREADY** | `activityRenderMode` collapsed|summary | |
| `/btw` isolated composer | **ALREADY** | `BtwPanel.tsx` present | |
| Files restore scroll/cursor | PORT | HP#8b | |
| Per-surface theme/fonts/layout | **PORTED** (full prefs) | `preferences.json` + `settings-registry.json` + UI `lib/settings/registry.ts`; `?surface=` via profile surfaces; `surfaceProfiles` seeds then drops | VS Code bridge HARD SKIP; persistence.ts still uses updateDesktopSettings (registry apply path available) |
| Desktop zoom → interface scale | **PORTED** | HP#13b / PR #755 (DOM rem zoom; traffic-light inset) | #755 |
| Mobile drawer UX batch | SKIP | mobile-only | |
| Comments Enter attaches | **PORTED** | desktop Enter attaches; Shift+Enter newline | this PR |
| Terminal render consistency / touch copy | **DEFER** | Tied to terminal stack | |
| Ctrl+N/P model lists | **PORTED** | dropdown-navigation + ModelPicker/menus/select/ChatInput (Batch B) | PR #756 |
| Send-shortcut / large-paste copy | **PORTED** | clearer queueMessages + largeTextPaste hints (Batch B); enterToSend skipped (PC uses queueMessages) | PR pending |
| Chat typography/spacing polish | **PORTED** (with glass visual-align) | Spacing/focus with floating composer | Bundled with glass composer port |
| Selection highlight unify | **PORTED** | `--oc-text-selection` + unified ::selection (Batch B) | PR #756 |
| Queue clear after reconnect | **PORTED** | client `reconcileAfterReconnect` on stream-reconnect/transport-switch (adapt; OC server queue N/A) | Batch C2 |
| False history-loading error | **ALREADY** | `session-message-loader`/`materialization` match OC 1.23.1; empty sessions commit ready; worktree bootstrap gate (#744) | no distinct delta vs OC tip |
| Relay/tunnel flow control | **ALREADY** | `event-stream/protocol.js` WS backpressure warn + isolate failed clients (matches OC) | |
| Fork restores attachments | **PORTED** | `pendingComposerRestore` destination-scoped handoff (OC #3387) | Batch C2 |
| Interrupted tools timer | **ALREADY** | `interruptedTurnToolParts` + tests present | |
| Duplicate attached images | **PORTED** | optimistic file replace scans all slots after text echo (event-reducer) | Batch C2 |
| Follow end on panel resize | **PORTED** | `onListMetricsChange` + `footerSize` end assert on resize settle | this PR |
| Message details narrow columns | **PORTED** | `useFactsFit` + `data-fact-priority` footer | this PR |
| Streaming Thinking scroll box | **ALREADY** | `ReasoningPart` capped scroll box + upward pause | verified vs OC 1.23 |
| Expanded composer Enter newline | **ALREADY** | `requiresModifierToSend = isMobile \|\| isDesktopExpanded` | verified |
| Narrow markdown tables | **PORTED** | `stabilizeMarkdownTableWidths` | this PR |
| Missing worktree relocation manual | **DEFER/verify** | | |
| Mobile dirty warning flash | SKIP | mobile | |
| Android nav bar | SKIP | mobile | |
| Terminal tab output isolation | **PORTED** | snapshot cols/rows + sized replay | this PR |
| NODE_CHANNEL_FD warning | **PORTED** | `resolvePosixPtyLaunch` + `delete env.NODE_CHANNEL_FD` | this PR |
| Native updater from web | **PORTED** | `desktopUpdater` + `web-update.ts` | this PR |
| Git token identity credential-helper | **PORTED** | `allowUnsafeCredentialHelper` | this PR |
| Branch compare local edits | **DEFER** | | |
| New-file diffs line-ending warnings | **PORTED** | `getNoIndexDiff` exit 0/1 | this PR |
| Usage provider fixes (Go/OpenRouter/Ollama/NeuralWatt/z.ai) | **SKIP** | OpenCode usage providers; keep Pichamber provider model | |
| Small-model endpoint details | **ALREADY** (Pi) | `callPiSmallModel` → `ModelRuntime.getModel(provider, model)` | OpenCode runtime-providers N/A |
| Electron instance probe timeout | **PORTED** | electron-host-probe + host-probe-policy (Batch C) | PR #757 |
| Interface scaling layout | **PORTED** | HP#13b — root rem scale + fixed traffic-light inset (PR #755) | #755 |
| Sidebar width preserve | ALREADY | HP#13a | |
| Linux Open In non-Latin | **SKIP** | Linux-specific; optional later | |
| Overlay scrollbar hover | **PORTED** | OverlayScrollbar pointerenter/leave reveal (PR #755) | #755 |
| Turkish glossary | **SKIP** | i18n-only unless touching strings we port | |
| `OPENCHAMBER_DATA_DIR` expansion | **PORTED** | migrateLegacyUserDirs for projects/themes/speech-models (Batch C) | PR #757 |

## Port order (planned PRs)

1. **Correctness/fixes:** scheduled `runNow` paused + project sync isolation; large-file edit; nested path already done  
2. **Git:** hunk UI; PR diff review in Changes  
3. **Chat:** queue collapse/preview; MD disclosures; turn files; follow-scroll; slash across projects  
4. **Sessions:** AI rename; archived-only retention (+ cascade)  
5. **Terminal:** context menu; Option word editing  
6. **Rest:** turn stats; worktree topology/checkout settings; Electron bump; deferred polish  

## Deferred (explicit)

- Full OC preferences.json + settings-registry per-surface split (**PORTED** this PR — preferences.json + registry gate + UI registry/generate; VS Code bridge HARD SKIP)
- ~~Glass/recap visual overhaul~~ → PORTED visual-align (features retained)  
- Mobile/Capacitor-only and VS Code-only items  
- OpenCode Usage providers (ClinePass/Hyper/Go/etc.)  
- AppImage OpenCode path  
- Repo-shared project-setup (large) — defer unless quick  
- Interface scale full port  
- Many soft UX verify items listed DEFER/verify above  
- History-scroll measure parity (verify first)

## Blockers / notes

- Disk on Air ~97% full; avoid `/tmp` worktrees (use `~/Documents/Code/Other/pichamber-wt-upstream`)  
- Do not kill running Pichamber without confirm  
- Never PR/push `openchamber/openchamber`  
- Cloud agents quota-exhausted — all work on Air worktrees  
- Terminal/hunk/PR ports need Desktop smoke after merge  


## Session 2026-09-12 defer-rest

Soft-UX + Terminal/Git + native updater ports in `port/upstream-1.23-defer-rest-softux`.
Remaining explicit: terminal render consistency via OC libghostty-vt migration (PC stays on ghostty-web + sized replay); OpenCode-only Usage/Revert/Share/AppImage/Capacitor/VS Code chrome (HARD SKIP). Desktop isolate PASS for softux on CDP 9755.
