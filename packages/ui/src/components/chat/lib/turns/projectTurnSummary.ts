import { summarizeLiveActivity } from './liveActivitySummary';
import type { ChatMessageEntry, TurnChangedFile, TurnDiffStats, TurnSummaryRecord } from './types';

interface SummaryDiff {
    file?: string | null;
    additions?: number | null;
    deletions?: number | null;
}

interface UserSummaryPayload {
    body?: string | null;
    diffs?: SummaryDiff[] | null;
}

const getTextFromPart = (part: unknown): string | undefined => {
    const text = (part as { text?: unknown }).text;
    if (typeof text === 'string' && text.trim().length > 0) {
        return text;
    }
    const content = (part as { content?: unknown }).content;
    if (typeof content === 'string' && content.trim().length > 0) {
        return content;
    }
    return undefined;
};

const isCompactionSummaryMessage = (message: ChatMessageEntry): boolean => {
    return (message.info as { summary?: unknown }).summary === true;
};

export const projectTurnSummary = (assistantMessages: ChatMessageEntry[]): TurnSummaryRecord => {
    for (let messageIndex = assistantMessages.length - 1; messageIndex >= 0; messageIndex -= 1) {
        const assistantMessage = assistantMessages[messageIndex];
        if (!assistantMessage) continue;
        if (isCompactionSummaryMessage(assistantMessage)) continue;

        const finish = (assistantMessage.info as { finish?: string | null }).finish;
        if (finish !== 'stop') continue;

        for (let partIndex = assistantMessage.parts.length - 1; partIndex >= 0; partIndex -= 1) {
            const part = assistantMessage.parts[partIndex];
            if (!part || part.type !== 'text') continue;

            const text = getTextFromPart(part);
            if (!text) continue;

            return {
                text,
                sourceMessageId: assistantMessage.info.id,
                sourcePartId: part.id ?? `${assistantMessage.info.id}-part-${partIndex}-text`,
            };
        }
    }

    for (let messageIndex = assistantMessages.length - 1; messageIndex >= 0; messageIndex -= 1) {
        const assistantMessage = assistantMessages[messageIndex];
        if (!assistantMessage) continue;
        if (isCompactionSummaryMessage(assistantMessage)) continue;

        for (let partIndex = assistantMessage.parts.length - 1; partIndex >= 0; partIndex -= 1) {
            const part = assistantMessage.parts[partIndex];
            if (!part || part.type !== 'text') continue;

            const text = getTextFromPart(part);
            if (!text) continue;

            return {
                text,
                sourceMessageId: assistantMessage.info.id,
                sourcePartId: part.id ?? `${assistantMessage.info.id}-part-${partIndex}-text`,
            };
        }
    }

    return {};
};

export const projectTurnDiffStats = (userMessage: ChatMessageEntry): TurnDiffStats | undefined => {
    const summary = (userMessage.info as { summary?: UserSummaryPayload | null }).summary;
    const diffs = summary?.diffs;
    if (!Array.isArray(diffs) || diffs.length === 0) {
        return undefined;
    }

    let additions = 0;
    let deletions = 0;
    let files = 0;

    diffs.forEach((diff) => {
        if (!diff) return;

        const diffAdditions = typeof diff.additions === 'number' ? diff.additions : 0;
        const diffDeletions = typeof diff.deletions === 'number' ? diff.deletions : 0;

        if (diffAdditions !== 0 || diffDeletions !== 0) {
            files += 1;
        }

        additions += diffAdditions;
        deletions += diffDeletions;
    });

    if (files === 0) {
        return undefined;
    }

    return {
        additions,
        deletions,
        files,
    };
};

export const projectTurnChangedFiles = (
    assistantMessages: ChatMessageEntry[],
    userMessage: ChatMessageEntry,
): TurnChangedFile[] | undefined => {
    /**
     * Files this turn changed, as evidenced by its own edit/write/patch calls.
     * The user message summary.diffs is a working-tree snapshot and may include
     * unrelated edits; use it only for line counts of files this turn touched.
     */
    const summary = summarizeLiveActivity(assistantMessages);
    const snapshotDiffs = userMessage.info.role === 'user'
        ? ((userMessage.info as { summary?: { diffs?: SummaryDiff[] | null } | null }).summary?.diffs ?? [])
        : [];
    const snapshotByFile = new Map<string, SummaryDiff>();
    for (const diff of snapshotDiffs) {
        if (diff && typeof diff.file === 'string' && diff.file.trim()) snapshotByFile.set(diff.file, diff);
    }

    const files = summary.changedFiles.map((change): TurnChangedFile => {
        const snapshot = snapshotByFile.get(change.path);
        if (!snapshot) {
            return change.additions !== undefined && change.deletions !== undefined
                ? { file: change.path, additions: change.additions, deletions: change.deletions, inTurnDiff: false }
                : { file: change.path, inTurnDiff: false };
        }
        const additions = typeof snapshot.additions === 'number' ? snapshot.additions : 0;
        const deletions = typeof snapshot.deletions === 'number' ? snapshot.deletions : 0;
        return additions === 0 && deletions === 0
            ? { file: change.path, inTurnDiff: true }
            : { file: change.path, additions, deletions, inTurnDiff: true };
    });

    if (summary.subagents > 0) {
        const own = new Set(files.map((file) => file.file));
        for (const diff of snapshotDiffs) {
            if (!diff?.file || own.has(diff.file)) continue;
            const additions = typeof diff.additions === 'number' ? diff.additions : 0;
            const deletions = typeof diff.deletions === 'number' ? diff.deletions : 0;
            if (additions === 0 && deletions === 0) continue;
            files.push({ file: diff.file, additions, deletions, inTurnDiff: true });
        }
    }

    return files.length > 0 ? files : undefined;
};
