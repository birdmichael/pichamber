import type { IconName } from "@/components/icon/icons";
import type { I18nKey } from "@/lib/i18n";
import { isFeaturePluginSlashName, isPlanSlashCommandText } from "@/lib/featurePlugins/slotStatus";

// A draft starter is a reference to an existing command or skill, pinned to the
// onboarding/draft welcome screen as a one-click chip. Scope (global vs project)
// is NOT stored here — it is encoded by which list the ref lives in (global =
// settings.json, project = project config), derived from the command/skill's own
// scope when pinned.
export type DraftStarterType = 'command' | 'skill';

export type DraftStarterRef = {
    type: DraftStarterType;
    name: string;
};

// In-app Pichamber session magic prompts. They are always available to pin,
// keep their bespoke icons, and seed the default global set. These are product
// starters, not OpenCode leftovers — they stay visible on the Pi kernel.
export type BuiltInStarter = {
    name: string;
    icon: IconName;
    labelKey: I18nKey;
    command: string;
};

export const BUILTIN_STARTERS: readonly BuiltInStarter[] = [
    { name: 'explore', icon: 'compass-3', labelKey: 'chat.draftPresets.explore.label', command: '/explore' },
    { name: 'catch-up', icon: 'history', labelKey: 'chat.draftPresets.catchup.label', command: '/catch-up' },
    { name: 'weigh', icon: 'scales-3', labelKey: 'chat.draftPresets.weigh.label', command: '/weigh' },
    { name: 'plan-feature', icon: 'survey', labelKey: 'chat.draftPresets.plan.label', command: '/plan-feature' },
    { name: 'craft-goal', icon: 'target', labelKey: 'chat.draftPresets.craftGoal.label', command: '/craft-goal' },
    { name: 'schedule-task', icon: 'calendar-schedule', labelKey: 'chat.draftPresets.scheduleTask.label', command: '/schedule-task' },
    { name: 'debug', icon: 'bug', labelKey: 'chat.draftPresets.debug.label', command: '/debug' },
    { name: 'review', icon: 'search-eye', labelKey: 'chat.draftPresets.review.label', command: '/workspace-review' },
];

const slashNameFromCommand = (command: string): string => command.replace(/^\//, '');

/** Slash names for in-app Pichamber starters. These stay available on Pi. */
export const PICHAMBER_STARTER_SLASH_COMMANDS: ReadonlySet<string> = new Set(
    BUILTIN_STARTERS.map((starter) => slashNameFromCommand(starter.command)),
);

export function isPichamberStarterSlashCommand(name: string): boolean {
    return PICHAMBER_STARTER_SLASH_COMMANDS.has(name);
}

/**
 * Empty-session welcome chips are Pichamber product starters.
 * Pi keeps the row; only the user visibility setting hides it.
 */
export function areDraftPresetChipsVisible(options: {
    visible: boolean;
    isPiKernel?: boolean;
}): boolean {
    return options.visible;
}

/**
 * Desktop (non-compact) empty chrome: title + starter chips live in ChatInput.
 * New-session draft and an existing session with zero messages share this surface.
 * Compact layouts (mobile / VS Code / mini-chat) use DraftWelcome instead.
 */
export function shouldShowDesktopDraftWelcomeChrome(options: {
    newSessionDraftOpen: boolean;
    emptySessionWelcome: boolean;
    isDesktopExpanded: boolean;
    isMobile: boolean;
    isVSCode: boolean;
    isMiniChatSurface: boolean;
}): boolean {
    if (options.isDesktopExpanded || options.isMobile || options.isVSCode || options.isMiniChatSurface) {
        return false;
    }
    return options.newSessionDraftOpen || options.emptySessionWelcome;
}

const BUILTIN_BY_NAME = new Map<string, BuiltInStarter>(BUILTIN_STARTERS.map((s) => [s.name, s]));

export const getBuiltInStarter = (name: string): BuiltInStarter | undefined => BUILTIN_BY_NAME.get(name);

// Default global starter set (used until the user customizes the global list).
export const DEFAULT_GLOBAL_STARTERS: readonly DraftStarterRef[] = BUILTIN_STARTERS.map((s) => ({
    type: 'command' as const,
    name: s.name,
}));

// Fallback icons for user-defined starters, matching the Settings sections.
export const COMMAND_FALLBACK_ICON: IconName = 'terminal-box';
export const SKILL_FALLBACK_ICON: IconName = 'book-open';

export const starterKey = (ref: DraftStarterRef): string => `${ref.type}:${ref.name}`;

export const sameStarter = (a: DraftStarterRef, b: DraftStarterRef): boolean =>
    a.type === b.type && a.name === b.name;

// Turn a command/skill name into a human chip label: "/simplify-code" -> "Simplify code".
export const normalizeStarterLabel = (name: string): string => {
    const base = name
        .replace(/^\//, '')
        .replace(/[-_]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    if (!base) return name;
    return base.charAt(0).toUpperCase() + base.slice(1);
};

// Parse persisted starter refs (from settings.json or project config) defensively.
export const sanitizeStarterRefs = (value: unknown): DraftStarterRef[] => {
    if (!Array.isArray(value)) return [];
    const out: DraftStarterRef[] = [];
    const seen = new Set<string>();
    for (const entry of value) {
        if (!entry || typeof entry !== 'object') continue;
        const record = entry as Record<string, unknown>;
        const type = record.type === 'command' || record.type === 'skill' ? record.type : null;
        const name = typeof record.name === 'string' ? record.name.trim() : '';
        if (!type || !name) continue;
        const key = `${type}:${name}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ type, name });
    }
    return out;
};

/** Live `/plan` `/run` `/goal` already have composer chrome. Do not pin them as send-on-click starters. */
export const shouldOfferLiveCommandAsStarter = (name: string): boolean => {
    if (getBuiltInStarter(name)) return false;
    return !isFeaturePluginSlashName(name);
};

/**
 * A pinned `/plan` chip on a new-session draft must match the footer Plan chip:
 * switch mode, do not mint a session until send.
 */
export const resolveDraftPlanStarterClick = (input: {
    submitText: string;
    draftOpen: boolean;
    composerText: string;
}): { kind: 'draft-plan'; sendText: string | null } | { kind: 'submit' } => {
    if (!input.draftOpen || !isPlanSlashCommandText(input.submitText)) {
        return { kind: 'submit' };
    }
    const trimmed = input.composerText.trim();
    if (isPlanSlashCommandText(trimmed)) {
        const rest = trimmed.replace(/^\/\s*plan\b/i, '').trim();
        return { kind: 'draft-plan', sendText: rest || null };
    }
    return { kind: 'draft-plan', sendText: trimmed || null };
};

