import React from 'react';
import { Icon } from '@/components/icon/Icon';
import { Skeleton } from '@/components/ui/skeleton';
import { useI18n } from '@/lib/i18n';
import { usePiKernel } from '@/lib/usePiKernel';
import { cn } from '@/lib/utils';
import { resolvePiThinkingChipPresentation } from './piThinking';
import { usePiThinkingChipStore } from './piThinkingChipStore';

interface MobileThinkingButtonProps {
    onOpenThinking: () => void;
    className?: string;
}

export const MobileThinkingButton: React.FC<MobileThinkingButtonProps> = ({
    onOpenThinking,
    className,
}) => {
    const { t } = useI18n();
    const isPiKernel = usePiKernel();
    const level = usePiThinkingChipStore((state) => state.level);
    const hasLevels = usePiThinkingChipStore((state) => state.hasLevels);
    const thinkingChip = resolvePiThinkingChipPresentation(level);

    if (!isPiKernel || !hasLevels) {
        return null;
    }

    const colorClass = thinkingChip.status === 'ready' && thinkingChip.level !== 'off'
        ? 'text-[color:var(--status-info)]'
        : 'text-muted-foreground';
    const ariaLabel = thinkingChip.status === 'ready'
        ? thinkingChip.label
        : t('common.loading');

    return (
        <button
            type="button"
            onClick={onOpenThinking}
            // Same guard as MobileModelButton: block the focus transfer so the
            // tap doesn't dismiss the keyboard. With interactive-widget=
            // resizes-content (Android), the keyboard-close relayout moves this
            // button mid-tap and the click never lands.
            onMouseDown={(event) => event.preventDefault()}
            onPointerDownCapture={(event) => {
                if (event.pointerType === 'touch') {
                    event.preventDefault();
                }
            }}
            aria-busy={thinkingChip.status === 'pending'}
            aria-label={ariaLabel}
            title={ariaLabel}
            className={cn(
                'inline-flex min-w-0 items-stretch',
                'rounded-lg',
                'typography-micro font-medium',
                'focus:outline-none hover:bg-[var(--interactive-hover)]',
                className,
            )}
            style={{ height: '26px', maxHeight: '26px', minHeight: '26px' }}
        >
            <span className="flex h-full w-full min-w-0 items-center gap-1">
                <Icon name="brain-ai-3" className={cn('size-4 flex-shrink-0', colorClass)} />
                {thinkingChip.status === 'ready' ? (
                    <span className={cn('truncate', colorClass)}>{thinkingChip.label}</span>
                ) : (
                    <Skeleton className="h-3 w-8 rounded-md flex-shrink-0" aria-hidden />
                )}
            </span>
        </button>
    );
};
