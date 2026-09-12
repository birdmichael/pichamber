import React from 'react';

import { Icon } from "@/components/icon/Icon";
import { cn } from '@/lib/utils';
import { useI18n } from '@/lib/i18n';
import { useAssistantStatus } from '@/hooks/useAssistantStatus';
import { useConfigStore } from '@/stores/useConfigStore';
import { getProviderModelDisplayName } from '@/lib/modelDisplay';

/**
 * Compact one-line mirror of the status row for the pill while streaming.
 */
const PillWorkingStatus: React.FC = () => {
    const { t } = useI18n();
    const { activeModel, working } = useAssistantStatus();
    const providers = useConfigStore((state) => state.providers);

    const modelName = React.useMemo(() => {
        if (!activeModel) return null;
        const provider = providers.find((candidate) => candidate.id === activeModel.providerId);
        return getProviderModelDisplayName(provider, activeModel.modelId) || null;
    }, [activeModel, providers]);

    if (!working.isWorking || !working.statusText) return null;
    const status = working.statusText;
    const label = modelName && modelName.trim().length > 0
        ? t('chat.statusRow.modelStatus', { model: modelName.trim(), status })
        : status.charAt(0).toUpperCase() + status.slice(1);

    return (
        <span className="min-w-0 truncate pr-3 text-sm text-muted-foreground">
            {label}
            <span className="animate-pulse"> …</span>
        </span>
    );
};

interface ScrollToBottomButtonProps {
    visible: boolean;
    /** Session still streaming: pill carries status while the floating row is away. */
    working?: boolean;
    onClick: () => void;
}

const ScrollToBottomButton: React.FC<ScrollToBottomButtonProps> = ({ visible, working = false, onClick }) => {
    const { t } = useI18n();
    return (
        <div
            className={cn(
                'pointer-events-none absolute bottom-full inset-x-0 mb-2 transition-opacity duration-100',
                visible ? 'opacity-100' : 'opacity-0',
            )}
            style={{ transform: 'translateY(calc(-1 * var(--chat-floating-panel-clearance, 0px)))' }}
        >
            <div className="chat-input-column">
                <div className="inline-flex max-w-full rounded-full shadow-[0_2px_6px_-2px_rgb(0_0_0_/_0.10)] dark:shadow-[0_2px_6px_-2px_rgb(0_0_0_/_0.35)]">
                <button
                    type="button"
                    onClick={onClick}
                    aria-label={t('chat.scrollToBottom.aria')}
                    className={cn(
                        'oc-glass-popover inline-flex h-8 max-w-full items-center rounded-full [corner-shape:round] text-left',
                        'border border-black/[0.06] dark:border-white/[0.08]',
                        visible ? 'pointer-events-auto' : 'pointer-events-none',
                    )}
                >
                    <span className="flex h-8 w-8 flex-1 shrink-0 basis-8 items-center justify-center text-muted-foreground">
                        <Icon name="arrow-down" className="h-4 w-4" />
                    </span>
                    {working && visible ? <PillWorkingStatus /> : null}
                </button>
                </div>
            </div>
        </div>
    );
};

export default React.memo(ScrollToBottomButton);
