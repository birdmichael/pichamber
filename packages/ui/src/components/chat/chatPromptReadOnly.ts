import type { Session } from '@opencode-ai/sdk/v2';
import { isReviewSession } from '@/lib/sessionReviewMetadata';

const isPiSubagentChildSession = (session: Session | null | undefined): boolean => {
    const metadata = session?.metadata as { pichamber?: { subagentRun?: { runId?: unknown } } } | undefined;
    return typeof metadata?.pichamber?.subagentRun?.runId === 'string'
        && metadata.pichamber.subagentRun.runId.trim().length > 0;
};

export const resolveChatPromptReadOnly = (
    session: Session | null | undefined,
    allowPromptingSubagentSessions: boolean,
    readOnly: boolean,
): boolean => {
    // Review sessions are independent conversations even if an older server or
    // cached record still carries parentID. Their explicit metadata is the
    // authority; only the surface itself may make them read-only.
    if (isReviewSession(session)) {
        return readOnly;
    }

    // Pi adapter children are writable follow-up sessions. The tab's own
    // readOnly flag is the authority; leftover OpenCode parentID locking
    // must not apply.
    if (isPiSubagentChildSession(session)) {
        return readOnly;
    }

    if (session?.parentID) {
        return !allowPromptingSubagentSessions;
    }

    return readOnly;
};
