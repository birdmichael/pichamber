# Composer

The chat composer: the prompt language, the editor that renders it, and
everything between typing and sending.

`ChatInput.tsx` (one directory up) is the orchestrator. It holds the composer's
own state and wires these modules together; it should not grow logic that
belongs to one of them.

On the Pi kernel, composer Enter does not send a normal chat turn while a Desktop `ctx.ui` prompt (`select` / `confirm` / `input` / `editor`) is waiting for that session. Submit or dismiss the in-chat card (or confirm modal) instead. This is not OpenCode `question.reply`. Opening a session hydrates pending `GET /api/pi/ui` prompts into the transcript even when there are no messages yet; the empty-chat welcome must not hide those cards. `/plan start` confirms with a `pi.ui.notify` toast on the shared desktop toast surface.
On Desktop, compact-composer Enter still sends and Shift+Enter inserts a newline. In the expanded composer, Enter inserts a newline and Cmd/Ctrl+Enter sends — Linux uses Ctrl+Enter. Mobile already required a modifier to send.
An existing session with zero messages uses the same Desktop welcome chrome as New session: the same `DraftPresetChips` the installed packages allow, plus the Session panel. The welcome title uses the same friendly workspace label as the sidebar (`~` for the home folder, or the opened project's name), not the raw last path segment. Chip click still submits through the composer send path on that session; it does not mint another chat.

OpenChamber Session Goal stays hidden on Pi (`isSessionGoalVisibleOnPiKernel`).
When Feature Plugins `goal` is installed and enabled, `ComposerFooter` shows
one `PiGoalButton` in that same cluster. Click opens a modal; a non-empty
objective submits `/goal <objective>` (or the configured command) through
`session.command` / `piSession.prompt`, not `promptAsync`. The host also
appends that `/goal` text as a user bubble and titles an Untitled session
from the objective. A `PiGoalStatusRow` above the composer shows the
latest `/goal` objective from the same chat Start Goal targets
(current session, then URL `?session=`, then last-active) until an
assistant says Goal complete, a Goal complete tool result lands, or
`metadata.pichamber.piGoal.active` is false — including when `/goal`
is last in the transcript. Read-only; not leftover OpenChamber
Session Goal. Sidebar Goal rows use `metadata.pichamber.piGoal.active`.
Recap and the follow-up chip stay hidden while the latest user turn
is `/goal`.
A new-session draft mints a real session first and does not switch the
open chat onto that id until `/goal` is accepted. If the store, URL
`?session=`, or last-active session already names a chat, Start Goal
must use that id even when an auto-draft welcome cleared
`currentSessionId`. Mint only when all of those are empty. A failed start keeps the
draft and the modal; retry reuses the minted session instead of creating
another. Start does not require a provider/model from the config store. The host
409s `/goal` while that session is already in Plan. Desktop also refuses Start
Goal while the Plan chip is on — including local draft Plan — and does not mint
or send `/goal`. The dialog copy matches the host 409, Start stays disabled,
and Exit Plan switches the chip back to Agent. Failures (no session,
missing live command, Plan mutex, send error) render inside the modal — Desktop
dialogs sit on the top layer, so toasts are not visible while it is open.
Agent→Plan on a draft toasts and shows a Plan row (`Plan starts when you send`).
A live `/plan start` also opens the Desktop Plan rail. Bare `/goal` is rejected. Disable or uninstall
hides the button. `ComposerFooter` still hides OpenCode-only
permission auto-accept, revert, and `/shell`.
On Pi it also no longer mounts the footer context-usage percent chip;
inspect tokens vs the model window from the desktop header context ring.
`ModelControls` hides the leftover OpenCode agent chip when the only
selectable agent is the synthetic Pi default (`shouldShowComposerAgentChip`).
Composer, Fork-session, and multi-run model pickers show the same context K
from one helper: live Pi `limit.context` / `contextWindow`, then the exact
provider/model catalog row, then the published table for that model id.
They do not use a fuzzy other-provider leftover or max-output tokens.
While a QuestionCard or pending Desktop `ctx.ui` input card is waiting, the
composer does not autofocus and does not steal keystrokes from that
textarea. A Pi `question` select card treats `Type something.` as Other
and uses the same textarea.
On Desktop (not VS Code), the thinking-level and model chips keep their
runtime labels when a right-hand panel narrows the composer. Session-width
rails keep thinking plus the full model name. Walkthrough and similarly
narrow rails (~0.6) still show thinking and a readable model name
(ellipsis of a few letters is fine; a single glyph is not). The provider
glyph hides on that squeeze so the name can use the slot; Agent/Plan
yields next. The model name is the runtime display string — do not
hardcode a provider, and do not move the chip into `/`. Labels collapse
to icons only as a last resort, and the chip tooltip/aria-label keeps the
same words. The leftover OpenCode agent label still hides first.
Agent/Plan is a separate chip and is not part of the thinking/model
collapse.
The empty-composer helper placeholder follows the same Desktop rule:
a typical ~1280 window with Session, Walkthrough, or notes open still
shows the full helper line (`chatHelperPlaceholderKey`). On Pi that is
`@ for files/agents; / for commands and skills; # for snippets` — no
`!` / shell, because `/shell` stays hidden and typing `!` does not open
a popup. Leftover OpenCode still mentions `!`. The short
`Use @ / # for helpers` stub (Pi) is only for true mobile or an actually
tiny editor (`shouldUseCompactChatPlaceholder`), not a normal right rail.
`MobilePillComposer` always uses the stub and the same kernel picker.
`MobileAgentButton` uses that same helper after `getVisibleAgents()` and
`isPrimaryMode`. The expanded mobile chip row hosts `MobileThinkingButton`
on Pi and `MobileModelButton`; those chips open the hidden `ModelControls`
bottom sheets (`variant` / `model` / `agent`). `ComposerFooter` `isMobile`
and collapsed `MobilePillComposer` do not host the leftover agent chip or
the thinking chip.
On Pi, `@agent` mentions do not switch session personality: the send path
does not route `@agent:build` / `@agent:plan` / leftover OpenCode names, the
prompt language does not classify those tokens as `agent`, and `@`
autocomplete does not list leftover OpenCode agents. Unknown `/name` stays
chat. `/btw` is intercepted for the Desktop fork panel only when Feature
Plugins `btw` (`npm:@narumitw/pi-btw`) is installed; without that package
it is an unknown slash and sends as chat. The OpenCode kernel keeps `@agent` mentions. The leftover mobile Pi
chip hide is already shipped (`shouldShowComposerAgentChip`).
When the Pi Plan plugin is installed and enabled, that slot is one **Agent / Plan**
dropdown — not a fake OpenCode agent, not two chips, and not Build/Plan. The
trigger shows the current side only. The control shows on an idle empty session
or new-session draft (status defaults to `off`) and does not wait for a plan
fetch. On a new-session draft, choosing Plan is local composer intent: it does
not `createSession` or leave the draft. That intent stays on this draft
until you send or pick Agent. A later New session starts on Agent. An
already-open session still shows its own stored Agent or Plan.
Send uses the same Agent materialize path, then `/plan start` on that new
session if Plan is not already on, then the prompt. An already-open session
still runs `/plan start` / save / exit on that same session. If an auto-draft welcome cleared `currentSessionId` while `?session=` or last-active still names a chat, Agent→Plan still `/plan start` on that id instead of storing local draft Plan intent. The `ComposerFooter` `isMobile` branch mounts the same `PiPlanModeToggle`
and `PiGoalButton` as Desktop (`MobilePillComposer` is the collapsed pill and
does not host those controls; they appear after expand). The left cluster
class `composer-mobile-actions` still clamps attach / Goal to a 24px icon
slot; `PiPlanModeToggle` opts out of that width so the current-side label
stays fully visible. Plan enters through `/plan start` (toast only — the plugin does not ask
a select) or resume of a saved plan. Leaving a ready plan uses `/plan save`.
Leaving Plan while it is on and there is no document uses `/plan exit`. Typing
listed `/plan` in the composer still sends empty arguments and opens the plugin
launch card. The slash menu must offer live `/plan` next to `/plan-feature`;
selecting it completes to `/plan`, not `/plan start`.
Desktop `/` docks a new-session composer to the bottom of the chat column
so the menu can use the space above it (a centered welcome only leaves
~256px). Docking the whole welcome block is not enough: the title and
starter chips stay in that block and leave only ~5 rows. While `/` is
open, hide that chrome and cancel the new-session `pb-[6vh]` inset, then
measure available height after that layout. Height comes from that space
up to the design cap in `slashPopupHeight.ts` and snaps to whole command
rows so the last visible name stays fully readable. Descriptions wrap
onto a second line at word boundaries so a typical command stays
understandable; `/run` uses plain-language copy, not plugin jargon.
Prefix filtering stays name-only on Pi. The CSS fallback must not be
`max-h-64`. Model and thinking chips stay off `/` and on the expanded
mobile composer, not the collapsed pill. On Pi the thinking chip lists
`GET /api/session/:id/thinking` `available` from live
`getAvailableThinkingLevels()`, not the full seven-level catalog, and
clamps the current chip onto that list. A new-session draft with no
session id uses models.dev `reasoning_options` for the selected model
so picking grok-4.6 does not flash all seven levels. OpenCode `build`
/ `plan` / custom agents still show. A Build row (session model + `/plan implement` in this session) appears
when a ready or saved plan exists, even if the View Plan rail is closed.

## Layers

| Directory | Owns |
|---|---|
| `language/` | What the text *means*: `@` references, `/` and `#` tokens, markdown, and which picker a caret asks for |
| `editor/` | The CodeMirror view that renders the language and owns the caret |
| `state/` | Composer state with a lifecycle: drafts, mobile shell, history, popup placement, draft targeting |
| `submit/` | Turning what the user has into what gets sent |
| `attachments/` | Files: paths, drop payloads |
| `ui/` | Presentation |
| `text.ts` | How inserted text meets the text already there |

## The prompt language

`language/` is the single source of truth for composer syntax. Everything that
needs to know what a token means — highlighting, send-time resolution, and the
autocomplete triggers — goes through it.

**This is the invariant that matters most in this module.** Before it existed,
the `@` rule was written four times with divergent cleanup and the `/` rule
three times with different valid character sets, so a token could be painted as
a reference and then not resolve as one. Adding a construct meant finding every
copy.

- `mentions.ts` — `@` references. The `start..end` span is the reference
  itself and is what gets highlighted; in `see @a/b.ts,` the comma is sentence
  punctuation, not part of the file being referenced. Mentions are plain
  editable text: deleting a character edits the token and reopens the mention
  picker, the same way `/skill` tokens behave — not an atomic delete. On Pi,
  leftover OpenCode agent names (`build`, `plan`, `@agent:build`) are not a
  mention kind; file `@path` references still resolve. The OpenCode kernel
  still classifies known agent names as `agent`.
- `prefixTokens.ts` — `/command`, `/skill`, `#snippet`. Scanning is deliberately
  generous; **membership in the command, skill or snippet registry is the
  authority**, not the pattern. An unknown `/token` stays plain prose. Enter
  on an empty slash popup closes it and sends that prose; Escape dismisses
  the popup. The key decision lives in `resolveCommandAutocompleteKey`. The
  empty-list footer uses `resolveCommandAutocompleteKeyboardHintKey` and must
  not advertise Enter select. On the
  Pi kernel, installed skills are slash targets as `/skill:name`; the scanner
  accepts `:` in the identifier so that form is one token.
- `triggers.ts` — which picker a caret position asks for. Exactly one can be
  active, with precedence `command > skill > snippet > mention`.
- `tokenize.ts` — one pass producing every highlight range. Adding a construct
  to the language means adding it here, once.

## The editor

`editor/` wraps CodeMirror. The document is a plain string: `getValue()` is
exactly what gets sent, so nothing downstream serializes a rich document model
back into a prompt.

The composer previously painted a transparent `<textarea>` over a mirror
`<div>`. That restricted highlighting to styles which do not change glyph
advance width — colour, background, underline — because anything else made the
mirror drift out from under the caret. Bold and italic were impossible, and the
overlay was disabled outright on mobile, where wrapped text drifted anyway.
**Those constraints are gone**; adding a width-affecting style is now a
question of design, not of feasibility.

Selection rendering: every device runs CodeMirror's `drawSelection()` — it
keeps typing on the drawn-selection code path, and removing it makes
CodeMirror enforce cursor association on the native selection, which iOS
answers with severe input lag. Every device also layers
`composerNativeSelectionExtension` (`editor/theme.ts`) on top: it re-shows
the native selection, and — only while a range is selected — the native caret,
hiding the painted layers those replace. The native selection is the one that
shows for two reasons: the painted layer sits behind the content, so tokens
with their own background (inline code, fences) cover it completely; and
iOS's selection drag handles attach to the visible native selection and take
their colour from the caret, so a transparent caret means invisible handles.
The range-only caret scoping is load-bearing — a native caret visible while
typing makes WebKit re-render its caret UI after every keystroke, felt as
severe input lag. The selection tint comes from `--primary`, not the selection
token:
themes define `--interactive-selection` with its own alpha, so a translucent
mix of it is nearly invisible.

`composerLanguage.ts` retokenizes the whole document on every change. The
composer holds a prompt, not a source file: it is short enough that a full pass
is cheaper and far simpler than incremental mapping, and it keeps the editor
and the send path reading the same grammar.

## Ordering rules worth knowing

- `editor/ComposerEditor.tsx` forwards a click on the composer's padding by
  focusing the view *before* setting the selection: CodeMirror reveals its
  drawn caret through a class it only writes while applying an update, so the
  selection has to be the update that follows the focus.
- `submit/buildOutgoingMessage.ts` flattens queued messages, the composer text,
  inline comments and context into OpenCode's one-primary-plus-parts shape. The
  oldest queued message becomes primary; **inline comments attach to the last
  body the user authored** rather than becoming their own part; PR instructions
  precede the PR diff.
- `state/useComposerDraft.ts` — a draft belongs to a (runtime, directory,
  session) identity. Writes are debounced while typing but forced at every edge
  where the page may stop running, because a pending timer is not a saved
  draft. Two orderings are load-bearing: the debounced write is skipped once
  while a draft is being restored, and a deleted draft's empty signature is
  recorded before a queued write could resurrect it.
- `state/useDraftTarget.ts` — the draft can target a directory that does not
  exist yet (a worktree being created). It must survive not appearing in the
  branch list, or the selector snaps back to the project root mid-creation.

## Mobile

`state/useMobileComposerShell.ts` and `state/useMobileViewportPin.ts` are
mostly not state machines but corrections for specific platform behaviors:
mobile browsers dismissing the keyboard before a tap's click lands, iOS
refusing programmatic focus outside a gesture, WebKit leaving the layout
viewport panned after the keyboard hides, overlay chains handing off through a
frame where nothing is open.

**Every timeout and `flushSync` in them has a reason recorded next to it, and
none of them is verifiable outside a real device.** Change them only against
hardware.

## Testing

The package has no DOM test environment, so coverage stops at the state and
logic layers: the language, the submit assembly, path and drop handling, text
splicing, message history, and the CodeMirror language extension at the
`EditorState` level.

Rendering, focus, keyboard behavior, IME and WKWebView are **not covered by
tests** and are verified by hand. Do not report a change to them as validated
on the strength of type-check and unit tests.

Run tests per file (`bun test <path>`): `mock.module` is process-global, so
suites that install module mocks are order-dependent.
