import { CHAT_DRAFT_PROJECT_ID } from '@/lib/chatDirectories';
import { normalizePath } from '@/lib/pathNormalization';
import { useSessionUIStore } from '@/sync/session-ui-store';
import { useSessionWorktreeStore } from '@/sync/session-worktree-store';
import { getAttachedSessionDirectory } from '@/sync/session-worktree-contract';
import { useSessionDirectory } from '@/sync/sync-context';
import { useDirectoryStore } from '@/stores/useDirectoryStore';

export type EffectiveDirectoryDraft = {
    open?: boolean;
    target?: 'chat' | 'project';
    bootstrapPendingDirectory?: string | null;
    directoryOverride?: string | null;
    preparedChatDirectory?: string | null;
};

export type EffectiveDirectoryInput = {
    currentSessionId?: string | null;
    sessionDirectory?: string | null;
    worktreeDirectory?: string | null;
    draft?: EffectiveDirectoryDraft | null;
    fallbackDirectory?: string | null;
};

const readDraftFilesystemDirectory = (draft?: EffectiveDirectoryDraft | null): string | undefined => {
    if (!draft?.open) return undefined;
    return (
        draft.bootstrapPendingDirectory
        || draft.directoryOverride
        || draft.preparedChatDirectory
        || undefined
    ) ?? undefined;
};

/**
 * Working directory for Files / Git / annotations. A projectless Chats draft
 * has no session directory yet and must not inherit the last project's path.
 */
export function resolveEffectiveDirectory(input: EffectiveDirectoryInput): string | undefined {
    if (input.currentSessionId) {
        if (input.worktreeDirectory) return input.worktreeDirectory;
        if (input.sessionDirectory) return input.sessionDirectory;
    }

    const draftDirectory = readDraftFilesystemDirectory(input.draft);
    if (draftDirectory) return draftDirectory;
    if (input.draft?.open && input.draft.target === 'chat') {
        return undefined;
    }

    return input.fallbackDirectory ?? undefined;
};

/**
 * Context-panel / browser identity. A projectless Chats draft uses the shared
 * chats bucket immediately so tabs and address history do not stay on the
 * last Settings project.
 */
export function resolveContextPanelDirectoryKey(
    effectiveDirectory: string | null | undefined,
    draft?: EffectiveDirectoryDraft | null,
): string {
    const normalized = normalizePath(effectiveDirectory ?? null);
    if (normalized) return normalized;
    if (draft?.open && draft.target === 'chat') return CHAT_DRAFT_PROJECT_ID;
    return '';
}

/**
 * Hook that resolves the effective working directory for tabs (Git, Diff, Files, Terminal).
 *
 * Priority order:
 * 1. Worktree metadata path (for worktree sessions)
 * 2. Session directory (for active sessions)
 * 3. Draft session directory (override / pending bootstrap / prepared chat dir)
 * 4. Fallback directory from DirectoryStore — never for a projectless Chats draft
 */
export const useEffectiveDirectory = (): string | undefined => {
    const currentSessionId = useSessionUIStore((s) => s.currentSessionId);
    const newSessionDraft = useSessionUIStore((s) => s.newSessionDraft);
    const currentSessionDirectory = useSessionDirectory(currentSessionId);
    const worktreeAttachment = useSessionWorktreeStore((s) => currentSessionId ? s.getAttachment(currentSessionId) : undefined);
    const worktreeMap = useSessionUIStore((s) => s.worktreeMetadata);
    const fallbackDirectory = useDirectoryStore((s) => s.currentDirectory);

    return resolveEffectiveDirectory({
        currentSessionId,
        sessionDirectory: currentSessionDirectory,
        worktreeDirectory: getAttachedSessionDirectory(worktreeAttachment) ?? worktreeMap.get(currentSessionId ?? '')?.path,
        draft: newSessionDraft,
        fallbackDirectory,
    });
};

/** Panel / browser key, including `openchamber:chats` for a projectless Chats draft. */
export const useContextPanelDirectoryKey = (): string => {
    const effectiveDirectory = useEffectiveDirectory();
    const currentSessionId = useSessionUIStore((s) => s.currentSessionId);
    const newSessionDraft = useSessionUIStore((s) => s.newSessionDraft);
    return resolveContextPanelDirectoryKey(
        effectiveDirectory,
        currentSessionId ? null : newSessionDraft,
    );
};
