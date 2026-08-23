import type { Message, Part } from '@opencode-ai/sdk/v2';

import { deriveMessageRole } from './messageRole';
import { filterVisibleParts, isEmptyTextPart, normalizeParts } from './partUtils';
import { normalizeUserDisplayParts } from './normalizeUserDisplayParts';

/**
 * A user message is hidden when none of its parts survive display
 * normalization (e.g. synthetic subagent-completion nudges, empty text
 * shells, or stray session-cwd chrome). Turns separated only by such
 * messages should render as one continuous flow.
 */
// Streaming recomputes turn projections often; cache by parts reference so
// unchanged messages resolve without re-running display normalization.
type HiddenCache = {
    planModeEnabled: boolean;
    directory: string;
    hidden: boolean;
};

const hiddenByParts = new WeakMap<Part[], HiddenCache>();

export type UserMessageVisibilityOptions = {
    planModeEnabled: boolean;
    directory?: string | null;
};

const directoryCacheKey = (directory?: string | null): string => (
    typeof directory === 'string' ? directory : ''
);

export const isHiddenUserMessage = (
    entry: { info: Message; parts: Part[] } | null | undefined,
    options: UserMessageVisibilityOptions,
): boolean => {
    if (!entry) return false;
    if (!deriveMessageRole(entry.info).isUser) return false;

    const directory = directoryCacheKey(options.directory);
    const cached = hiddenByParts.get(entry.parts);
    if (
        cached
        && cached.planModeEnabled === options.planModeEnabled
        && cached.directory === directory
    ) {
        return cached.hidden;
    }

    const parts = normalizeUserDisplayParts(normalizeParts(entry.parts), {
        planModeEnabled: options.planModeEnabled,
        directory: options.directory,
    });
    const hidden = filterVisibleParts(parts, { includeReasoning: true }).length === 0;
    hiddenByParts.set(entry.parts, {
        planModeEnabled: options.planModeEnabled,
        directory,
        hidden,
    });
    return hidden;
};

const isSyntheticPart = (part: Part): boolean => (part as { synthetic?: boolean }).synthetic === true;

/**
 * True when a user message exists as a shell but its text has not arrived
 * yet. Intentionally hidden synthetic nudges and stray cwd/path chrome are
 * not pending paint — they should stay gone rather than hold a skeleton.
 */
export const isPendingUserMessagePaint = (
    entry: { info: Message; parts: Part[] } | null | undefined,
    options: UserMessageVisibilityOptions,
): boolean => {
    if (!entry) return false;
    if (!deriveMessageRole(entry.info).isUser) return false;

    const raw = normalizeParts(entry.parts);
    if (raw.length === 0) return true;
    if (raw.every(isSyntheticPart)) return false;
    if (!isHiddenUserMessage(entry, options)) return false;
    return raw.some((part) => part.type === 'text' && isEmptyTextPart(part))
        || raw.every((part) => part.type === 'text' && isEmptyTextPart(part));
};

export const hasPendingUserTranscriptPaint = (
    messages: ReadonlyArray<{ info: Message; parts: Part[] }>,
    options: UserMessageVisibilityOptions,
): boolean => messages.some((message) => isPendingUserMessagePaint(message, options));
