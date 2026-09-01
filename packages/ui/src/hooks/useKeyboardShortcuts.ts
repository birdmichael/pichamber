import React from 'react';
import { isTerminalEventTarget } from '@/lib/terminalFocus';
import { useSessionUIStore } from '@/sync/session-ui-store';
import { activateAdjacentSessionTab, activateSessionTabByIndex, closeSessionTabAndActivateNeighbour } from '@/lib/sessionTabs';
import { useSelectionStore } from '@/sync/selection-store';
import * as sessionActions from '@/sync/session-actions';
import { normalizeContextPanelDirectoryKey, useUIStore } from '@/stores/useUIStore';
import { useThemeSystem } from '@/contexts/useThemeSystem';
import { useCurrentSessionActivity } from '@/hooks/useSessionActivity';
import { useKeybinds } from '@/hooks/useKeybind';
import { readInheritedNewSessionDraftOptions } from '@/lib/newSessionInherit';
import { createWorktreeSession } from '@/lib/worktreeSessionCreator';
import { useConfigStore } from '@/stores/useConfigStore';
import { canUseElectronDesktopIPC, invokeDesktop, isVSCodeRuntime } from '@/lib/desktop';
import { showOpenCodeStatus } from '@/lib/openCodeStatus';
import {
  eventMatchesShortcut,
  eventMatchesShortcutPrefix,
  getEffectiveShortcutCombo,
  getEffectiveShortcutPrefix,
  normalizeCombo,
  resolveShortcutEventDigit,
  resolveShortcutEventKey,
  ShortcutDispatcher,
  shortcutRegistry,
  type ShortcutActionId,
} from '@/lib/shortcuts';
import { resolvePlanRailEnabled } from '@/lib/surfaces/planRail';
import { getVisibleContextRailSurfaces } from '@/lib/surfaces/registry';
import { usePiKernel } from '@/lib/usePiKernel';
import { usePiFeaturePluginsStore } from '@/sync/pi-feature-plugins-store';
import { usePiSessionPlanStore } from '@/sync/pi-session-plan-store';
import { readEmbeddedThemeSearchParams } from '@/contexts/theme-embedded-bootstrap';
import { useDirectoryStore } from '@/stores/useDirectoryStore';
import { useGitStore } from '@/stores/useGitStore';
import { useProjectsStore } from '@/stores/useProjectsStore';
import { useFeatureFlagsStore } from '@/stores/useFeatureFlagsStore';
import { useContextPanelDirectoryKey } from '@/hooks/useEffectiveDirectory';
import { getCycledPrimaryAgentName } from '@/components/chat/mobileControlsUtils';
import { focusChatInput } from '@/components/chat/composer/editor/dom';
import { isQuestionAnswerTextarea } from '@/components/chat/questionAnswerFocus';
import { addSelectionToChat } from '@/lib/addSelectionToChat';
import { shouldCloseMainSurfaceOnEscape } from '@/lib/main-surface-dismiss';
import { hasOpenDropdown, isEditableEventTarget, shouldStopDropdownImeEscape } from './keyboard-shortcut-dom';

const dropdownTargetSelector = [
  '[data-slot="dropdown-menu-content"]', '[data-slot="select-content"]', '[role="combobox"]',
  '[role="listbox"]', '[role="menu"]', '[role="menuitem"]', '[role="option"]',
  '[data-radix-popper-content-wrapper]',
].join(',');

export const useKeyboardShortcuts = () => {
  const openNewSessionDraft = useSessionUIStore((s) => s.openNewSessionDraft);
  const armAbortPrompt = useSessionUIStore((s) => s.armAbortPrompt);
  const clearAbortPrompt = useSessionUIStore((s) => s.clearAbortPrompt);
  const currentSessionId = useSessionUIStore((s) => s.currentSessionId);
  const currentDirectory = useDirectoryStore((s) => s.currentDirectory);
  const panelDirectoryKey = useContextPanelDirectoryKey();
  const activeProject = useProjectsStore((s) => s.getActiveProject());
  const { themeMode, setThemeMode } = useThemeSystem();
  const { phase: sessionPhase } = useCurrentSessionActivity();
  const isPiKernel = usePiKernel();
  const abortPrimedUntilRef = React.useRef<number | null>(null);
  const abortPrimedTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const themeModeRef = React.useRef(themeMode);
  const dispatcherRef = React.useRef<ShortcutDispatcher | null>(null);
  const heldKeysRef = React.useRef<Set<string>>(new Set());

  if (!dispatcherRef.current) {
    dispatcherRef.current = new ShortcutDispatcher({
      registry: shortcutRegistry,
      getBinding: (actionId) => getEffectiveShortcutCombo(
        actionId,
        useUIStore.getState().shortcutOverrides,
      ),
    });
  }
  const dispatcher = dispatcherRef.current;

  React.useEffect(() => { themeModeRef.current = themeMode; }, [themeMode]);

  const resetAbortPriming = React.useCallback(() => {
    if (abortPrimedTimeoutRef.current) {
      clearTimeout(abortPrimedTimeoutRef.current);
      abortPrimedTimeoutRef.current = null;
    }
    abortPrimedUntilRef.current = null;
    clearAbortPrompt();
  }, [clearAbortPrompt]);

  const toggleTerminalSurface = React.useCallback(() => {
    if (!panelDirectoryKey) return;
    useUIStore.getState().openContextSurface(normalizeContextPanelDirectoryKey(panelDirectoryKey), 'terminal');
  }, [panelDirectoryKey]);

  const toggleTerminalSurfaceExpanded = React.useCallback(() => {
    if (!panelDirectoryKey) return;
    const key = normalizeContextPanelDirectoryKey(panelDirectoryKey);
    const state = useUIStore.getState();
    const panel = state.contextPanelByDirectory[key];
    const activeMode = panel?.isOpen ? panel.tabs.find((tab) => tab.id === panel.activeTabId)?.mode : null;
    if (activeMode !== 'terminal') {
      state.openContextSurface(key, 'terminal');
    }
    state.toggleContextPanelExpanded(key);
  }, [panelDirectoryKey]);

  useKeybinds({
    open_command_palette: () => {
      useUIStore.getState().toggleCommandPalette();
    },
    open_timeline_dialog: () => {
      useUIStore.getState().setTimelineDialogOpen(true);
    },
    open_session_list: () => {
      const state = useUIStore.getState();
      if (state.isMobile) {
        state.setSessionSwitcherOpen(true);
        return;
      }
      if (state.isSidebarOpen) {
        window.dispatchEvent(new CustomEvent('openchamber:sidebar-session-search'));
        return;
      }
      state.setSessionDropdownOpen(true);
    },
    toggle_prompt_navigator: () => {
      const state = useUIStore.getState();
      const hasOverlay = state.isSettingsDialogOpen
        || state.isCommandPaletteOpen
        || state.isHelpDialogOpen
        || state.isSessionSwitcherOpen
        || state.isAboutDialogOpen
        || state.isTimelineDialogOpen
        || state.isMultiRunLauncherOpen
        || Boolean(state.multiRunCompareGroup)
        || state.isImagePreviewOpen;
      if (
        !state.promptNavigatorEnabled
        || state.isMobile
        || isVSCodeRuntime()
        || state.activeMainTab !== 'chat'
        || hasOverlay
      ) {
        return false;
      }
      state.togglePromptNavigatorPanel();
    },
    open_help: () => {
      useUIStore.getState().toggleHelpDialog();
    },
    open_status: () => {
      void showOpenCodeStatus();
    },
    new_mini_chat: () => {
      if (!canUseElectronDesktopIPC()) return false;
      void invokeDesktop('desktop_open_draft_mini_chat_window', {
        directory: currentDirectory || activeProject?.path || '',
        projectId: activeProject?.id ?? null,
      }).catch((error) => {
        console.warn('[keyboard-shortcuts] failed to open draft mini chat window', error);
      });
    },
    switch_session_previous: () => {
      if (isVSCodeRuntime() || !useUIStore.getState().sessionTabsEnabled) return false;
      return activateAdjacentSessionTab(-1) ? undefined : false;
    },
    switch_session_next: () => {
      if (isVSCodeRuntime() || !useUIStore.getState().sessionTabsEnabled) return false;
      return activateAdjacentSessionTab(1) ? undefined : false;
    },
    close_session_tab: () => {
      if (isVSCodeRuntime() || !useUIStore.getState().sessionTabsEnabled) return false;
      if (currentSessionId) {
        closeSessionTabAndActivateNeighbour(currentSessionId);
      }
    },
    new_chat: () => {
      useUIStore.getState().setActiveMainTab('chat');
      useUIStore.getState().setSessionSwitcherOpen(false);
      openNewSessionDraft(readInheritedNewSessionDraftOptions());
    },
    new_chat_worktree: () => {
      useUIStore.getState().setActiveMainTab('chat');
      useUIStore.getState().setSessionSwitcherOpen(false);
      if (!isVSCodeRuntime()) {
        createWorktreeSession();
        return;
      }
      openNewSessionDraft(readInheritedNewSessionDraftOptions());
    },
    cycle_theme: () => {
      if (readEmbeddedThemeSearchParams() !== null && window.parent && window.parent !== window) {
        window.parent.postMessage({ type: 'openchamber:cycle-theme-request' }, window.location.origin);
        return;
      }
      const modes: Array<'light' | 'dark' | 'system'> = ['light', 'dark', 'system'];
      const activeElement = document.activeElement as HTMLElement | null;
      setThemeMode(modes[(modes.indexOf(themeModeRef.current) + 1) % modes.length]);
      requestAnimationFrame(() => {
        if (!document.hasFocus()) window.focus();
        if (activeElement && document.contains(activeElement)) activeElement.focus({ preventScroll: true });
      });
    },
    open_settings: () => {
      const state = useUIStore.getState();
      state.setSettingsDialogOpen(!state.isSettingsDialogOpen);
    },
    add_selection_to_chat: (event) => {
      if (isQuestionAnswerTextarea(event.target)) return false;
      addSelectionToChat();
    },
    toggle_sidebar: () => {
      const state = useUIStore.getState();
      if (state.isMobile) state.setSessionSwitcherOpen(!state.isSessionSwitcherOpen);
      else state.toggleSidebar();
    },
    focus_input: (event) => {
      if (isQuestionAnswerTextarea(event.target)) return false;
      focusChatInput();
    },
    cycle_agent: (event) => {
      const state = useUIStore.getState();
      const hasOverlay = state.isSettingsDialogOpen
        || state.isCommandPaletteOpen
        || state.isHelpDialogOpen
        || state.isSessionSwitcherOpen
        || state.isAboutDialogOpen;
      const isChatInputTarget = event.target instanceof Element
        && Boolean(event.target.closest('[data-chat-input="true"]'));
      if (hasOverlay || state.activeMainTab !== 'chat' || !isChatInputTarget) return false;
      const combo = getEffectiveShortcutCombo('cycle_agent', state.shortcutOverrides);
      const backward = combo && !combo.includes('shift') ? normalizeCombo(`shift+${combo}`) : '';
      const direction = backward && eventMatchesShortcut(event, backward) ? -1 : 1;
      const config = useConfigStore.getState();
      const next = getCycledPrimaryAgentName(config.getVisibleAgents(), config.currentAgentName, direction);
      if (!next) return false;
      config.setAgent(next);
      state.addRecentAgent(next);
      const sessionId = useSessionUIStore.getState().currentSessionId;
      if (sessionId) {
        useSelectionStore.getState().saveSessionAgentSelection(sessionId, next);
      }
    },
    toggle_terminal: () => {
      if (useUIStore.getState().isMobile) return false;
      return toggleTerminalSurface();
    },
    toggle_terminal_expanded: () => {
      if (useUIStore.getState().isMobile) return false;
      return toggleTerminalSurfaceExpanded();
    },
    toggle_right_sidebar: () => {
      const state = useUIStore.getState();
      if (state.isMobile || !currentDirectory) return false;
      const directory = normalizeContextPanelDirectoryKey(currentDirectory);
      const panelState = state.contextPanelByDirectory[directory];
      if (panelState?.isOpen) {
        state.closeContextPanel(directory);
      } else if (panelState?.activeTabId) {
        state.setActiveContextPanelTab(directory, panelState.activeTabId);
      } else {
        state.openContextSurface(directory, 'git');
      }
    },
    open_right_sidebar_git: () => {
      const state = useUIStore.getState();
      if (state.isMobile || !currentDirectory) return false;
      state.openContextSurface(normalizeContextPanelDirectoryKey(currentDirectory), 'git');
    },
    open_right_sidebar_files: () => {
      const state = useUIStore.getState();
      if (state.isMobile || !currentDirectory) return false;
      state.openContextSurface(normalizeContextPanelDirectoryKey(currentDirectory), 'file');
    },
    open_model_selector: () => {
      const state = useUIStore.getState();
      const hasOverlay = state.isCommandPaletteOpen
        || state.isHelpDialogOpen
        || state.isSessionSwitcherOpen
        || state.isAboutDialogOpen;
      if (state.isSettingsDialogOpen || hasOverlay || state.activeMainTab !== 'chat') return false;
      state.setModelSelectorOpen(!state.isModelSelectorOpen);
    },
    cycle_thinking_variant: () => {
      const state = useUIStore.getState();
      const hasOverlay = state.isCommandPaletteOpen
        || state.isHelpDialogOpen
        || state.isSessionSwitcherOpen
        || state.isAboutDialogOpen;
      if (state.isSettingsDialogOpen || hasOverlay || state.activeMainTab !== 'chat') return false;
      const config = useConfigStore.getState();
      if (config.getCurrentModelVariants().length === 0) return false;
      config.cycleCurrentVariant();
      const sessionId = useSessionUIStore.getState().currentSessionId;
      const { currentAgentName, currentProviderId, currentModelId, currentVariant } = useConfigStore.getState();
      if (sessionId && currentAgentName && currentProviderId && currentModelId) {
        useSelectionStore.getState().saveAgentModelVariantForSession(
          sessionId,
          currentAgentName,
          currentProviderId,
          currentModelId,
          currentVariant,
        );
      }
    },
    cycle_favorite_model_forward: () => cycleFavoriteModel(1),
    cycle_favorite_model_backward: () => cycleFavoriteModel(-1),
    expand_input: () => {
      if (useUIStore.getState().isMobile) return false;
      useUIStore.getState().toggleExpandedInput();
    },
    toggle_dictation: () => {
      const state = useUIStore.getState();
      if (
        state.activeMainTab !== 'chat'
        || state.isCommandPaletteOpen
        || state.isHelpDialogOpen
        || state.isSessionSwitcherOpen
        || state.isSettingsDialogOpen
      ) {
        return false;
      }
      window.dispatchEvent(new CustomEvent('openchamber:dictation-toggle'));
    },
    abort_run: () => {
      if (sessionPhase === 'idle' || !currentSessionId) return false;
      void sessionActions.abortCurrentOperation(currentSessionId);
    },
  });

  function cycleFavoriteModel(delta: number): boolean | void {
    const state = useUIStore.getState();
    const hasOverlay = state.isCommandPaletteOpen
      || state.isHelpDialogOpen
      || state.isSessionSwitcherOpen
      || state.isAboutDialogOpen;
    if (
      state.isSettingsDialogOpen
      || hasOverlay
      || state.activeMainTab !== 'chat'
      || state.favoriteModels.length === 0
    ) {
      return false;
    }
    const config = useConfigStore.getState();
    const index = state.favoriteModels.findIndex((model) => (
      model.providerID === config.currentProviderId && model.modelID === config.currentModelId
    ));
    const next = state.favoriteModels[(index + delta + state.favoriteModels.length) % state.favoriteModels.length];
    config.setProvider(next.providerID);
    config.setModel(next.modelID);
    state.addRecentModel(next.providerID, next.modelID);
  }

  React.useEffect(() => {
    const invokeRegistered = (actionId: ShortcutActionId, event: KeyboardEvent): boolean => {
      const handler = shortcutRegistry.get(actionId);
      return handler ? handler(event) !== false : false;
    };
    const handleTerminalShortcutCapture = (event: KeyboardEvent) => {
      if (!isTerminalEventTarget(event.target)) return;
      const getBinding = (actionId: ShortcutActionId) => getEffectiveShortcutCombo(
        actionId,
        useUIStore.getState().shortcutOverrides,
      );
      const actionId = eventMatchesShortcut(event, getBinding('toggle_terminal')) ? 'toggle_terminal'
        : eventMatchesShortcut(event, getBinding('toggle_terminal_expanded')) ? 'toggle_terminal_expanded' : null;
      if (actionId && invokeRegistered(actionId, event)) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    const handleEscapeKeyDownCapture = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (dispatcher.handleEscape()) {
        event.preventDefault();
        resetAbortPriming();
        return;
      }
      const target = event.target as Element | null;
      const state = useUIStore.getState();
      const isDropdownTarget = target instanceof Element
        && target.closest(dropdownTargetSelector);
      const dropdownOpen = Boolean(isDropdownTarget || hasOpenDropdown());
      if (shouldStopDropdownImeEscape(event, dropdownOpen)) {
        event.stopImmediatePropagation();
        resetAbortPriming();
        return;
      }
      if (
        target?.closest('[role="dialog"]')
        || isTerminalEventTarget(target)
        || dropdownOpen
      ) {
        resetAbortPriming();
        return;
      }
      if (state.isPromptNavigatorPanelOpen) {
        event.preventDefault();
        state.setPromptNavigatorPanelOpen(false);
        resetAbortPriming();
        return;
      }
      if (state.isSettingsDialogOpen) {
        event.preventDefault();
        state.setSettingsDialogOpen(false);
        resetAbortPriming();
        return;
      }
      if (document.querySelector('[data-settings-view="true"]')) {
        resetAbortPriming();
        return;
      }
      if (shouldCloseMainSurfaceOnEscape({
        isArchivePageOpen: state.isArchivePageOpen,
        isScheduledTasksDialogOpen: state.isScheduledTasksDialogOpen,
        worktreesPageProjectId: state.worktreesPageProjectId,
        isMultiRunLauncherOpen: state.isMultiRunLauncherOpen,
        multiRunCompareGroup: state.multiRunCompareGroup,
      })) {
        event.preventDefault();
        state.closeMainSurfaces();
        resetAbortPriming();
        return;
      }
      const hasOverlay = state.isCommandPaletteOpen
        || state.isHelpDialogOpen
        || state.isSessionSwitcherOpen
        || state.isAboutDialogOpen
        || state.isMultiRunLauncherOpen
        || Boolean(state.multiRunCompareGroup)
        || state.isImagePreviewOpen;
      if (
        hasOverlay
        || state.activeMainTab !== 'chat'
        || sessionPhase === 'idle'
        || !currentSessionId
      ) {
        resetAbortPriming();
        return;
      }
      const now = Date.now();
      if (abortPrimedUntilRef.current && now < abortPrimedUntilRef.current) {
        resetAbortPriming();
        if (invokeRegistered('abort_run', event)) event.preventDefault();
        return;
      }
      event.preventDefault();
      const expiresAt = armAbortPrompt(3000) ?? now + 3000;
      abortPrimedUntilRef.current = expiresAt;
      if (abortPrimedTimeoutRef.current) clearTimeout(abortPrimedTimeoutRef.current);
      abortPrimedTimeoutRef.current = setTimeout(() => {
        if (abortPrimedUntilRef.current && Date.now() >= abortPrimedUntilRef.current) {
          resetAbortPriming();
        }
      }, Math.max(expiresAt - now, 0));
    };
    const handleActivePrefixKeyDownCapture = (event: KeyboardEvent) => {
      if (isTerminalEventTarget(event.target)) return;
      if (!dispatcher.hasActivePrefix()) return;
      // Unmodified keys in an editor are typing, even if this field armed the
      // leader. Modifier/function-key completions still run.
      if (
        !event.ctrlKey && !event.metaKey && !event.altKey
        && isEditableEventTarget(event.target)
      ) {
        dispatcher.clear();
        return;
      }
      if (dispatcher.dispatchActivePrefix(event)) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (dispatcher.consumeCapturedPrefixEvent(event)) return;
      if (event.key === 'Escape' || isTerminalEventTarget(event.target)) return;
      if (shortcutRegistry.isSuspended()) return;
      const combo = getEffectiveShortcutCombo('cycle_agent', useUIStore.getState().shortcutOverrides);
      const backward = combo && !combo.includes('shift') ? normalizeCombo(`shift+${combo}`) : '';
      if (backward && eventMatchesShortcut(event, backward)) {
        if (invokeRegistered('cycle_agent', event)) event.preventDefault();
        return;
      }

      const rawDigit = resolveShortcutEventDigit(event);
      const switchSurfaceDigit = rawDigit !== null
        ? (rawDigit === '0' ? 10 : Number(rawDigit))
        : null;
      const switchSurfacePrefix = getEffectiveShortcutPrefix(
        'switch_context_surface',
        useUIStore.getState().shortcutOverrides,
      );
      if (
        switchSurfaceDigit !== null
        && !event.repeat
        && eventMatchesShortcutPrefix(event, switchSurfacePrefix, heldKeysRef.current)
      ) {
        if (isEditableEventTarget(event.target)) return;
        const state = useUIStore.getState();
        if (!state.isMobile && panelDirectoryKey) {
          const directory = normalizeContextPanelDirectoryKey(panelDirectoryKey);
          const panel = state.contextPanelByDirectory[directory];
          const sessionId = useSessionUIStore.getState().currentSessionId;
          const visibleSurfaces = getVisibleContextRailSurfaces({
            railOrder: state.contextRailOrder,
            planModeEnabled: resolvePlanRailEnabled({
              isPiKernel,
              featurePlugins: usePiFeaturePluginsStore.getState().payload,
              plan: sessionId ? usePiSessionPlanStore.getState().plansBySession[sessionId] ?? null : null,
              planModeExperimentalEnabled: useFeatureFlagsStore.getState().planModeEnabled,
            }),
            isVSCode: isVSCodeRuntime(),
            screenWidth: window.innerWidth,
            tabs: panel?.tabs ?? [],
            isGitRepo: useGitStore.getState().directories.get(directory)?.isGitRepo === true,
          });
          const target = visibleSurfaces[switchSurfaceDigit - 1];
          if (target) {
            event.preventDefault();
            state.openContextSurface(directory, target.mode);
            return;
          }
        }
      }

      const sessionTabDigit = rawDigit !== null && rawDigit !== '0' ? Number(rawDigit) : null;
      if (
        sessionTabDigit !== null
        && !event.repeat
        && !isVSCodeRuntime()
        && !isEditableEventTarget(event.target)
        && useUIStore.getState().sessionTabsEnabled
        && eventMatchesShortcutPrefix(
          event,
          getEffectiveShortcutPrefix('switch_session_tab', useUIStore.getState().shortcutOverrides),
          heldKeysRef.current,
        )
        && activateSessionTabByIndex(sessionTabDigit - 1)
      ) {
        event.preventDefault();
        return;
      }

      if (dispatcher.dispatch(event)) event.preventDefault();
    };
    const handleKeyHoldDown = (event: KeyboardEvent) => {
      heldKeysRef.current.add(event.key.toLowerCase());
      heldKeysRef.current.add(resolveShortcutEventKey(event).toLowerCase());
    };
    const handleKeyUp = (event: KeyboardEvent) => {
      heldKeysRef.current.delete(event.key.toLowerCase());
      heldKeysRef.current.delete(resolveShortcutEventKey(event).toLowerCase());
    };
    const handleBlur = () => {
      heldKeysRef.current.clear();
      dispatcher.handleBlur();
    };
    window.addEventListener('keydown', handleKeyHoldDown, true);
    window.addEventListener('keyup', handleKeyUp, true);
    window.addEventListener('keydown', handleTerminalShortcutCapture, true);
    window.addEventListener('keydown', handleEscapeKeyDownCapture, true);
    window.addEventListener('keydown', handleActivePrefixKeyDownCapture, true);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('blur', handleBlur);
    return () => {
      window.removeEventListener('keydown', handleKeyHoldDown, true);
      window.removeEventListener('keyup', handleKeyUp, true);
      window.removeEventListener('keydown', handleTerminalShortcutCapture, true);
      window.removeEventListener('keydown', handleEscapeKeyDownCapture, true);
      window.removeEventListener('keydown', handleActivePrefixKeyDownCapture, true);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('blur', handleBlur);
    };
  }, [
    armAbortPrompt,
    currentSessionId,
    dispatcher,
    isPiKernel,
    panelDirectoryKey,
    resetAbortPriming,
    sessionPhase,
  ]);

  React.useEffect(() => () => resetAbortPriming(), [resetAbortPriming]);
};
