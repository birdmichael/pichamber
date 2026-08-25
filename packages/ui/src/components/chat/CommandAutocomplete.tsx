import React from 'react';
import { cn, isMacOS } from '@/lib/utils';
import { useSessionUIStore } from '@/sync/session-ui-store';
import { useSessionMessages } from '@/sync/sync-context';
import { useCommandsStore } from '@/stores/useCommandsStore';
import { useSkillsStore } from '@/stores/useSkillsStore';
import { ScrollableOverlay } from '@/components/ui/ScrollableOverlay';
import { Icon } from "@/components/icon/Icon";
import { useI18n } from '@/lib/i18n';
import { useUIStore } from '@/stores/useUIStore';
import { isVSCodeRuntime } from '@/lib/desktop';
import { usePiKernel } from '@/lib/usePiKernel';
import { refreshFeaturePlugins, usePiBtwPluginAvailable, usePiPlanPluginAvailable, usePiSubagentsPluginAvailable } from '@/sync/pi-feature-plugins-store';
import { useMobileAutocompleteMaxHeight } from './useMobileAutocompleteMaxHeight';
import { commandHasPiSlashPrefix, commandMatchesPiSlashQuery, commandMatchesSearch, ensureLiveFeatureSlashCommands, filterPiSlashCommands, mergeCommandAutocompleteItems, resolveCommandAutocompleteKey, resolveCommandAutocompleteKeyboardHintKey, resolveSlashMenuDescription } from './commandAutocompleteItems';
import {
  DESKTOP_SLASH_DESCRIPTION_CLASS,
  DESKTOP_SLASH_POPUP_MAX_HEIGHT_CLASS,
  measureDesktopSlashAvailablePx,
  readOverlayMaxHeight,
  resolveDesktopSlashPopupMaxHeight,
} from './slashPopupHeight';

type CommandSource = 'openchamber' | 'opencode' | 'skill';

export interface CommandInfo {
  id: string;
  name: string;
  source: CommandSource;
  description?: string;
  searchAliases?: string[];
  agent?: string;
  model?: string;
  isBuiltIn?: boolean;
  isOpenChamber?: boolean;
  isSkill?: boolean;
  injected?: boolean;
  scope?: string;
}

export interface CommandAutocompleteHandle {
  /** Returns whether the composer should consume the key (preventDefault). */
  handleKeyDown: (key: string) => boolean;
}

const BASE_BADGE_CLASS = "text-[10px] leading-none uppercase font-bold tracking-tight px-1.5 py-1 rounded border flex-shrink-0";
const TYPE_BADGE_CLASS = cn(
  BASE_BADGE_CLASS,
  "bg-[color-mix(in_srgb,var(--primary-base)_12%,transparent)] text-[color-mix(in_srgb,var(--primary-base)_70%,transparent)] border-[color-mix(in_srgb,var(--primary-base)_24%,transparent)]"
);
const USER_BADGE_CLASS = cn(
  BASE_BADGE_CLASS,
  "bg-[color-mix(in_srgb,var(--status-success)_12%,transparent)] text-[color-mix(in_srgb,var(--status-success)_70%,transparent)] border-[color-mix(in_srgb,var(--status-success)_24%,transparent)]"
);
const PROJECT_BADGE_CLASS = cn(
  BASE_BADGE_CLASS,
  "bg-[color-mix(in_srgb,var(--status-info)_12%,transparent)] text-[color-mix(in_srgb,var(--status-info)_70%,transparent)] border-[color-mix(in_srgb,var(--status-info)_24%,transparent)]"
);
const NEUTRAL_BADGE_CLASS = cn(
  BASE_BADGE_CLASS,
  "bg-[var(--surface-muted)] text-muted-foreground border-[var(--interactive-border)]/60"
);


interface CommandAutocompleteProps {
  searchQuery: string;
  onCommandSelect: (command: CommandInfo) => void;
  onClose: () => void;
  style?: React.CSSProperties;
}

export const CommandAutocomplete = React.forwardRef<CommandAutocompleteHandle, CommandAutocompleteProps>(({
  searchQuery,
  onCommandSelect,
  onClose,
  style,
}, ref) => {
  const { t } = useI18n();
  const isPiKernel = usePiKernel();
  const planPluginAvailable = usePiPlanPluginAvailable();
  const subagentsPluginAvailable = usePiSubagentsPluginAvailable();
  const btwPluginAvailable = usePiBtwPluginAvailable();

  React.useEffect(() => {
    if (isPiKernel) void refreshFeaturePlugins();
  }, [isPiKernel]);
  const currentSessionId = useSessionUIStore((state) => state.currentSessionId);
  const sessionMessages = useSessionMessages(currentSessionId ?? '');
  const hasMessagesInCurrentSession = sessionMessages.length > 0;
  const hasSession = Boolean(currentSessionId);
  const hasNewSessionDraft = useSessionUIStore((state) => Boolean(state.newSessionDraft?.open));
  const canStartSessionCommand = hasSession || hasNewSessionDraft;
  const isMobile = useUIStore((state) => state.isMobile);
  const canUseReviewHandoffFlow = hasSession && !isMobile && !isVSCodeRuntime();

  const [commands, setCommands] = React.useState<CommandInfo[]>([]);
  const [loading, setLoading] = React.useState(false);
  const commandsWithMetadata = useCommandsStore((s) => s.commands);
  const refreshCommands = useCommandsStore((s) => s.loadCommands);
  const skills = useSkillsStore((s) => s.skills);
  const refreshSkills = useSkillsStore((s) => s.loadSkills);
  const [selectedIndex, setSelectedIndex] = React.useState(0);
  const selectedIndexRef = React.useRef(0);
  const keyboardNavigationRef = React.useRef(false);
  const itemRefs = React.useRef<(HTMLDivElement | null)[]>([]);
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const footerRef = React.useRef<HTMLDivElement | null>(null);
  const availableMaxHeight = useMobileAutocompleteMaxHeight(containerRef, isMobile);
  const [desktopAvailablePx, setDesktopAvailablePx] = React.useState<number | undefined>(undefined);
  const [rowMetrics, setRowMetrics] = React.useState<{ rowHeightPx: number; chromePx: number } | null>(null);
  const popupMaxHeight = isMobile
    ? availableMaxHeight
    : resolveDesktopSlashPopupMaxHeight({
        availablePx: desktopAvailablePx,
        overlayMaxHeightPx: readOverlayMaxHeight(style),
        rowHeightPx: rowMetrics?.rowHeightPx,
        chromePx: rowMetrics?.chromePx,
      });
  const ignoreClickRef = React.useRef(false);
  const pointerStartRef = React.useRef<{ x: number; y: number } | null>(null);
  const pointerMovedRef = React.useRef(false);

  React.useEffect(() => {
    const handlePointerDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node | null;
      if (!target || !containerRef.current) {
        return;
      }
      if (containerRef.current.contains(target)) {
        return;
      }
      onClose();
    };

    document.addEventListener('pointerdown', handlePointerDown, true);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true);
    };
  }, [onClose]);

  React.useEffect(() => {
    // Force refresh to get latest project context when mounting
    void refreshCommands();
    void refreshSkills();
  }, [refreshCommands, refreshSkills]);

  React.useEffect(() => {
    const loadCommands = async () => {
      setLoading(true);
      try {
        const skillByName = new Map(skills.map((skill) => [skill.name, skill]));
        const customCommands: CommandInfo[] = commandsWithMetadata.map((cmd, index) => ({
          id: `opencode:${cmd.scope ?? 'global'}:${cmd.name}:${cmd.agent ?? ''}:${cmd.model ?? ''}:${index}`,
          name: cmd.name,
          source: 'opencode',
          description: cmd.description,
          agent: cmd.agent ?? undefined,
          model: cmd.model ?? undefined,
          isBuiltIn: cmd.name === 'init' || cmd.name === 'review',
          isSkill: cmd.source === 'skill' || skillByName.has(cmd.name),
          injected: skillByName.get(cmd.name)?.injected,
          scope: cmd.scope,
        }));
        const skillCommands: CommandInfo[] = skills.map((skill, index) => ({
          id: `skill:${skill.scope}:${skill.source ?? 'opencode'}:${skill.name}:${index}`,
          name: skill.name,
          source: 'skill',
          description: skill.description,
          isSkill: true,
          injected: skill.injected,
          scope: skill.scope,
        }));

        const builtInCommands: CommandInfo[] = [
          ...(hasSession && !hasMessagesInCurrentSession
            ? [{ id: 'openchamber:init', name: 'init', source: 'openchamber' as const, description: t('chat.commandAutocomplete.command.initDescription'), isBuiltIn: true }]
            : []
          ),
          ...(hasSession  // Show when session exists, not when hasMessages
            ? [
                { id: 'openchamber:undo', name: 'undo', source: 'openchamber' as const, description: t('chat.commandAutocomplete.command.undoDescription'), isBuiltIn: true },
                { id: 'openchamber:redo', name: 'redo', source: 'openchamber' as const, description: t('chat.commandAutocomplete.command.redoDescription'), isBuiltIn: true },
                { id: 'openchamber:timeline', name: 'timeline', source: 'openchamber' as const, description: t('chat.commandAutocomplete.command.timelineDescription'), isBuiltIn: true },
              ]
            : []
          ),
          { id: 'openchamber:compact', name: 'compact', source: 'openchamber' as const, description: t('chat.commandAutocomplete.command.compactDescription'), isBuiltIn: true },
          ...(hasSession
            ? [{ id: 'openchamber:summary', name: 'summary', source: 'openchamber' as const, description: t('chat.commandAutocomplete.command.summaryDescription'), isOpenChamber: true }]
            : []
          ),
          ...(canStartSessionCommand
            ? [{ id: 'openchamber:workspace-review', name: 'workspace-review', source: 'openchamber' as const, description: t('chat.commandAutocomplete.command.workspaceReviewDescription'), isOpenChamber: true }]
            : []
          ),
          ...(canUseReviewHandoffFlow
            ? [{ id: 'openchamber:handoff-review', name: 'handoff-review', source: 'openchamber' as const, description: t('chat.commandAutocomplete.command.handoffReviewDescription'), isOpenChamber: true }]
            : []
          ),
          ...(canStartSessionCommand
            ? [{ id: 'openchamber:plan-feature', name: 'plan-feature', source: 'openchamber' as const, description: t('chat.commandAutocomplete.command.featurePlanDescription'), isOpenChamber: true }]
            : []
          ),
          ...(canStartSessionCommand
            ? [{ id: 'openchamber:craft-goal', name: 'craft-goal', source: 'openchamber' as const, description: t('chat.commandAutocomplete.command.craftGoalDescription'), isOpenChamber: true }]
            : []
          ),
          ...(canStartSessionCommand
            ? [{ id: 'openchamber:schedule-task', name: 'schedule-task', source: 'openchamber' as const, description: t('chat.commandAutocomplete.command.scheduleTaskDescription'), isOpenChamber: true }]
            : []
          ),
          ...(canStartSessionCommand
            ? [{ id: 'openchamber:catch-up', name: 'catch-up', source: 'openchamber' as const, description: t('chat.commandAutocomplete.command.catchUpDescription'), isOpenChamber: true }]
            : []
          ),
          ...(canStartSessionCommand
            ? [{ id: 'openchamber:debug', name: 'debug', source: 'openchamber' as const, description: t('chat.commandAutocomplete.command.debugDescription'), isOpenChamber: true }]
            : []
          ),
          ...(canStartSessionCommand
            ? [{ id: 'openchamber:weigh', name: 'weigh', source: 'openchamber' as const, description: t('chat.commandAutocomplete.command.weighDescription'), isOpenChamber: true }]
            : []
          ),
          ...(canStartSessionCommand
            ? [{ id: 'openchamber:explore', name: 'explore', source: 'openchamber' as const, description: t('chat.commandAutocomplete.command.exploreDescription'), isOpenChamber: true }]
            : []
          ),
        ];
        const allCommands = ensureLiveFeatureSlashCommands(
          filterPiSlashCommands(mergeCommandAutocompleteItems(builtInCommands, customCommands, skillCommands), isPiKernel),
          { isPiKernel, planPluginAvailable, subagentsPluginAvailable, btwPluginAvailable },
        );

        const allowInitCommand = !hasMessagesInCurrentSession;
        const matchesQuery = isPiKernel ? commandMatchesPiSlashQuery : commandMatchesSearch;
        const filtered = (searchQuery
          ? allCommands.filter(cmd => matchesQuery(cmd, searchQuery))
          : allCommands).filter(cmd => allowInitCommand || cmd.name !== 'init');

        filtered.sort((a, b) => {
          const aStartsWith = isPiKernel
            ? commandHasPiSlashPrefix(a, searchQuery)
            : a.name.toLowerCase().startsWith(searchQuery.toLowerCase());
          const bStartsWith = isPiKernel
            ? commandHasPiSlashPrefix(b, searchQuery)
            : b.name.toLowerCase().startsWith(searchQuery.toLowerCase());
          if (aStartsWith && !bStartsWith) return -1;
          if (!aStartsWith && bStartsWith) return 1;
          return a.name.localeCompare(b.name);
        });

        setCommands(filtered);
      } catch {

        const allowInitCommand = !hasMessagesInCurrentSession;
        const builtInCommands: CommandInfo[] = [
          ...(hasSession && !hasMessagesInCurrentSession
            ? [{ id: 'openchamber:init', name: 'init', source: 'openchamber' as const, description: t('chat.commandAutocomplete.command.initDescription'), isBuiltIn: true }]
            : []
          ),
          ...(hasSession  // Show when session exists, not when hasMessages
            ? [
                { id: 'openchamber:undo', name: 'undo', source: 'openchamber' as const, description: t('chat.commandAutocomplete.command.undoDescription'), isBuiltIn: true },
                { id: 'openchamber:redo', name: 'redo', source: 'openchamber' as const, description: t('chat.commandAutocomplete.command.redoDescription'), isBuiltIn: true },
                { id: 'openchamber:timeline', name: 'timeline', source: 'openchamber' as const, description: t('chat.commandAutocomplete.command.timelineDescription'), isBuiltIn: true },
              ]
            : []
          ),
          { id: 'openchamber:compact', name: 'compact', source: 'openchamber' as const, description: t('chat.commandAutocomplete.command.compactDescription'), isBuiltIn: true },
          ...(hasSession
            ? [{ id: 'openchamber:summary', name: 'summary', source: 'openchamber' as const, description: t('chat.commandAutocomplete.command.summaryDescription'), isOpenChamber: true }]
            : []
          ),
          ...(canStartSessionCommand
            ? [{ id: 'openchamber:workspace-review', name: 'workspace-review', source: 'openchamber' as const, description: t('chat.commandAutocomplete.command.workspaceReviewDescription'), isOpenChamber: true }]
            : []
          ),
          ...(canUseReviewHandoffFlow
            ? [{ id: 'openchamber:handoff-review', name: 'handoff-review', source: 'openchamber' as const, description: t('chat.commandAutocomplete.command.handoffReviewDescription'), isOpenChamber: true }]
            : []
          ),
          ...(canStartSessionCommand
            ? [{ id: 'openchamber:plan-feature', name: 'plan-feature', source: 'openchamber' as const, description: t('chat.commandAutocomplete.command.featurePlanDescription'), isOpenChamber: true }]
            : []
          ),
          ...(canStartSessionCommand
            ? [{ id: 'openchamber:craft-goal', name: 'craft-goal', source: 'openchamber' as const, description: t('chat.commandAutocomplete.command.craftGoalDescription'), isOpenChamber: true }]
            : []
          ),
          ...(canStartSessionCommand
            ? [{ id: 'openchamber:schedule-task', name: 'schedule-task', source: 'openchamber' as const, description: t('chat.commandAutocomplete.command.scheduleTaskDescription'), isOpenChamber: true }]
            : []
          ),
          ...(canStartSessionCommand
            ? [{ id: 'openchamber:catch-up', name: 'catch-up', source: 'openchamber' as const, description: t('chat.commandAutocomplete.command.catchUpDescription'), isOpenChamber: true }]
            : []
          ),
          ...(canStartSessionCommand
            ? [{ id: 'openchamber:debug', name: 'debug', source: 'openchamber' as const, description: t('chat.commandAutocomplete.command.debugDescription'), isOpenChamber: true }]
            : []
          ),
          ...(canStartSessionCommand
            ? [{ id: 'openchamber:weigh', name: 'weigh', source: 'openchamber' as const, description: t('chat.commandAutocomplete.command.weighDescription'), isOpenChamber: true }]
            : []
          ),
          ...(canStartSessionCommand
            ? [{ id: 'openchamber:explore', name: 'explore', source: 'openchamber' as const, description: t('chat.commandAutocomplete.command.exploreDescription'), isOpenChamber: true }]
            : []
          ),
        ];

        const fallbackCommands = ensureLiveFeatureSlashCommands(
          filterPiSlashCommands(builtInCommands, isPiKernel),
          { isPiKernel, planPluginAvailable, subagentsPluginAvailable, btwPluginAvailable },
        );
        const matchesQuery = isPiKernel ? commandMatchesPiSlashQuery : commandMatchesSearch;
        const filtered = (searchQuery
          ? fallbackCommands.filter(cmd => matchesQuery(cmd, searchQuery))
          : fallbackCommands).filter(cmd => allowInitCommand || cmd.name !== 'init');

        setCommands(filtered);
      } finally {
        setLoading(false);
      }
    };

    loadCommands();
  }, [searchQuery, hasMessagesInCurrentSession, hasSession, canStartSessionCommand, canUseReviewHandoffFlow, commandsWithMetadata, skills, t, isPiKernel, planPluginAvailable, subagentsPluginAvailable, btwPluginAvailable]);

  React.useEffect(() => {
    setSelectedIndex(0);
  }, [commands]);

  React.useEffect(() => {
    selectedIndexRef.current = selectedIndex;
  }, [selectedIndex]);

  React.useEffect(() => {
    itemRefs.current[selectedIndex]?.scrollIntoView({
      block: 'nearest'
    });
  }, [selectedIndex]);

  React.useLayoutEffect(() => {
    if (isMobile) {
      return;
    }
    const measure = () => {
      const containerEl = containerRef.current;
      if (!containerEl) {
        return;
      }
      const chatArea = containerEl.closest('[data-chat-area]') ?? containerEl.closest('main');
      if (chatArea) {
        const availablePx = measureDesktopSlashAvailablePx({
          chatTopPx: chatArea.getBoundingClientRect().top,
          popupBottomPx: containerEl.getBoundingClientRect().bottom,
          visualTopPx: window.visualViewport?.offsetTop ?? 0,
        });
        setDesktopAvailablePx((prev) => (prev === availablePx ? prev : availablePx));
      }
      if (loading) {
        return;
      }
      const rowEls = itemRefs.current
        .slice(0, commands.length)
        .filter((el): el is HTMLDivElement => el !== null);
      if (rowEls.length === 0) {
        return;
      }
      const rowHeightPx = Math.round(Math.max(
        ...rowEls.map((el) => el.getBoundingClientRect().height),
      ));
      if (rowHeightPx <= 0) {
        return;
      }
      const footerPx = footerRef.current
        ? Math.round(footerRef.current.getBoundingClientRect().height)
        : 0;
      const borderY = containerEl.offsetHeight - containerEl.clientHeight;
      const chromePx = footerPx + borderY;
      setRowMetrics((prev) => (
        prev && prev.rowHeightPx === rowHeightPx && prev.chromePx === chromePx
          ? prev
          : { rowHeightPx, chromePx }
      ));
    };
    measure();
    const containerEl = containerRef.current;
    const observed = [
      containerEl?.closest('[data-chat-area]') ?? containerEl?.closest('main'),
      containerEl?.closest('form'),
    ].filter((el): el is Element => el != null);
    const resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    for (const el of observed) {
      resizeObserver?.observe(el);
    }
    window.addEventListener('resize', measure);
    window.visualViewport?.addEventListener('resize', measure);
    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener('resize', measure);
      window.visualViewport?.removeEventListener('resize', measure);
    };
  }, [commands, isMobile, loading]);

  React.useImperativeHandle(ref, () => ({
    handleKeyDown: (key: string) => {
      const total = commands.length;
      const action = resolveCommandAutocompleteKey(key, total);

      if (action.type === 'close' || action.type === 'close-and-send') {
        onClose();
        return action.consume;
      }

      if (action.type === 'navigate') {
        keyboardNavigationRef.current = true;
        const delta = action.direction === 'next' ? 1 : -1;
        setSelectedIndex((prev) => (prev + delta + total) % total);
        return action.consume;
      }

      if (action.type === 'select') {
        const safeIndex = ((selectedIndexRef.current % total) + total) % total;
        const command = commands[safeIndex];
        if (command) {
          onCommandSelect(command);
        }
      }

      return action.consume;
    }
  }), [commands, onClose, onCommandSelect]);

  const getCommandIcon = (command: CommandInfo) => {

    switch (command.name) {
      case 'init':
        return <Icon name="file" className="h-3.5 w-3.5 text-green-500" />;
      case 'undo':
        return <Icon name="arrow-go-back" className="h-3.5 w-3.5 text-orange-500" />;
      case 'redo':
        return <Icon name="arrow-go-forward" className="h-3.5 w-3.5 text-orange-500" />;
      case 'timeline':
        return <Icon name="time" className="h-3.5 w-3.5" />;
      case 'compact':
        return <Icon name="scissors" className="h-3.5 w-3.5 text-purple-500" />;
      case 'review':
        return <Icon name="search-eye" className="h-3.5 w-3.5 text-blue-500" />;
      case 'test':
      case 'build':
      case 'run':
        return <Icon name="terminal-box" className="h-3.5 w-3.5 text-cyan-500" />;
      default:
        if (command.isBuiltIn) {
          return <Icon name="flashlight" className="h-3.5 w-3.5 text-yellow-500" />;
        }
        return <Icon name={isMacOS() ? 'command' : 'slash-commands-2'} className="h-3.5 w-3.5 text-muted-foreground" />;
    }
  };

  return (
    <div
      ref={containerRef}
      className={cn(
        'absolute z-[100] min-w-0 w-full max-w-[450px] overflow-hidden bg-background border-2 border-border/60 rounded-xl shadow-none bottom-full mb-2 left-0 flex flex-col',
        isMobile ? 'max-h-64' : DESKTOP_SLASH_POPUP_MAX_HEIGHT_CLASS,
      )}
      style={popupMaxHeight !== undefined ? { ...style, maxHeight: popupMaxHeight } : style}
    >
      <ScrollableOverlay preventOverscroll outerClassName="flex-1 min-h-0" className="px-0 pb-2">
        {loading ? (
          <div className="flex items-center justify-center py-4">
            <Icon name="refresh" className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div>
            {commands.map((command, index) => {
              const isSystem = command.isBuiltIn;
              const isOpenChamberBadge = command.isOpenChamber;
              const description = resolveSlashMenuDescription(command, {
                runDescription: t('chat.commandAutocomplete.command.runDescription'),
                btwDescription: t('chat.commandAutocomplete.command.btwDescription'),
              });
              return (
                <div
                  key={command.id}
                  ref={(el) => { itemRefs.current[index] = el; }}
                  className={cn(
                    "flex gap-2 px-3 py-2 cursor-pointer rounded-lg",
                    isMobile ? "items-center" : "items-start",
                    index === selectedIndex && "bg-interactive-selection"
                  )}
                  // Block the focus transfer the tap would perform: the textarea
                  // must stay focused so selecting a command doesn't dismiss the
                  // soft keyboard (the blur raced the keyboard-hide trigger and
                  // won against the deferred refocus).
                  onMouseDown={(event) => event.preventDefault()}
                  onPointerDown={(event) => {
                    if (event.pointerType !== 'touch') {
                      return;
                    }
                    pointerStartRef.current = { x: event.clientX, y: event.clientY };
                    pointerMovedRef.current = false;
                  }}
                  onPointerMove={(event) => {
                    if (event.pointerType !== 'touch' || !pointerStartRef.current) {
                      return;
                    }
                    const dx = event.clientX - pointerStartRef.current.x;
                    const dy = event.clientY - pointerStartRef.current.y;
                    if (Math.hypot(dx, dy) > 6) {
                      pointerMovedRef.current = true;
                    }
                  }}
                  onPointerUp={(event) => {
                    if (event.pointerType !== 'touch') {
                      return;
                    }
                    const didMove = pointerMovedRef.current;
                    pointerStartRef.current = null;
                    pointerMovedRef.current = false;
                    if (didMove) {
                      return;
                    }
                    event.preventDefault();
                    event.stopPropagation();
                    ignoreClickRef.current = true;
                    onCommandSelect(command);
                  }}
                  onPointerCancel={() => {
                    pointerStartRef.current = null;
                    pointerMovedRef.current = false;
                  }}
                  onClick={() => {
                    if (ignoreClickRef.current) {
                      ignoreClickRef.current = false;
                      return;
                    }
                    onCommandSelect(command);
                  }}
                  onMouseMove={() => {
                    keyboardNavigationRef.current = false;
                    setSelectedIndex(index);
                  }}
                >
                  <div className={cn(!isMobile && "mt-0.5")}>
                    {getCommandIcon(command)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="typography-ui-label font-medium">/{command.name}</span>
                      {command.isSkill ? (
                        <span className={TYPE_BADGE_CLASS}>
                          {t('chat.commandAutocomplete.badge.skill')}
                        </span>
                      ) : (
                        <span className={TYPE_BADGE_CLASS}>
                          {t('chat.commandAutocomplete.badge.command')}
                        </span>
                      )}
                      {isOpenChamberBadge ? (
                        <span className={NEUTRAL_BADGE_CLASS}>
                          Pichamber
                        </span>
                      ) : isSystem ? (
                        <span className={NEUTRAL_BADGE_CLASS}>
                          {t('chat.commandAutocomplete.badge.system')}
                        </span>
                      ) : command.scope ? (
                        <span className={command.scope === 'project' ? PROJECT_BADGE_CLASS : USER_BADGE_CLASS}>
                          {command.scope}
                        </span>
                      ) : null}
                      {command.agent && (
                        <span className={NEUTRAL_BADGE_CLASS}>
                          {String(command.agent).toLowerCase() === 'openchamber' ? 'Pichamber' : command.agent}
                        </span>
                      )}
                    </div>
                    {description && !isMobile && (
                      <div className={DESKTOP_SLASH_DESCRIPTION_CLASS}>
                        {description}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
            {commands.length === 0 && (
              <div className="px-3 py-2 typography-ui-label text-muted-foreground">
                {t('chat.commandAutocomplete.empty')}
              </div>
            )}
          </div>
        )}
      </ScrollableOverlay>
      {!isMobile && (
        <div ref={footerRef} className="px-3 pt-1 pb-1.5 border-t typography-meta text-muted-foreground">
          {t(resolveCommandAutocompleteKeyboardHintKey(loading ? 0 : commands.length))}
        </div>
      )}
    </div>
  );
});

CommandAutocomplete.displayName = 'CommandAutocomplete';
