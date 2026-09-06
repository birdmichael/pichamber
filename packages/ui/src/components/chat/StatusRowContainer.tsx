import React from 'react';

import { useAssistantStatus } from '@/hooks/useAssistantStatus';
import { useConfigStore } from '@/stores/useConfigStore';
import { useSessionUIStore } from '@/sync/session-ui-store';
import { getProviderModelRefDisplayName } from '@/lib/modelDisplay';
import { StatusRow } from './StatusRow';

/**
 * Status row wrapper.
 * Uses the dedicated assistant status hook so the row keeps accurate live activity
 * labels while still limiting subscriptions to the active assistant message.
 */
export const StatusRowContainer: React.FC = React.memo(() => {
    const currentSessionId = useSessionUIStore((state) => state.currentSessionId);
    const abortRecord = useSessionUIStore(
        React.useCallback((state) => {
            if (!currentSessionId) {
                return null;
            }
            return state.sessionAbortFlags?.get(currentSessionId) ?? null;
        }, [currentSessionId]),
    );
    const { activeModel, working } = useAssistantStatus();
    const currentAgentName = useConfigStore((state) => state.currentAgentName);

    const modelDisplayName = React.useMemo(() => {
        if (!activeModel) {
            return null;
        }
        return getProviderModelRefDisplayName(activeModel.providerId, activeModel.modelId) || null;
    }, [activeModel]);

    const wasAborted = Boolean(abortRecord && !abortRecord.acknowledged);

    return (
        <StatusRow
            isWorking={working.isWorking}
            statusText={working.statusText}
            isGenericStatus={working.isGenericStatus}
            isWaitingForPermission={working.isWaitingForPermission}
            wasAborted={wasAborted || working.wasAborted}
            abortActive={wasAborted || working.abortActive}
            retryInfo={working.retryInfo}
            showAssistantStatus
            showTodos={false}
            agentName={currentAgentName}
            modelName={modelDisplayName}
            thinkingLevel={working.thinkingLevel}
            providerId={activeModel?.providerId ?? null}
        />
    );
});

StatusRowContainer.displayName = 'StatusRowContainer';
