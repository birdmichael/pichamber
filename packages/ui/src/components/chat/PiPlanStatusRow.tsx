import React from 'react';

import { Icon } from '@/components/icon/Icon';
import { usePiPlanChrome } from '@/hooks/usePiPlanChrome';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { resolvePlanStatusRowHint } from '@/sync/pi-session-plan';

interface PiPlanStatusRowProps {
  className?: string;
}

export const PiPlanStatusRow: React.FC<PiPlanStatusRowProps> = React.memo(({
  className,
}) => {
  const { t } = useI18n();
  const chrome = usePiPlanChrome();
  const hintKind = resolvePlanStatusRowHint({
    footerPlanSelected: chrome.footerPlanSelected,
    draftOpen: chrome.draftOpen,
  });

  if (!chrome.showToggle || !hintKind) return null;

  const hint = hintKind === 'draft'
    ? t('chat.piPlan.draftHint')
    : t('chat.piPlan.enabledNotify');

  return (
    <div
      className={cn(
        'flex w-full min-w-0 items-center gap-2 rounded-lg border px-2 py-1',
        'border-[var(--interactive-border)]',
        className,
      )}
      aria-label={t('chat.piPlan.row.aria')}
      title={hint}
    >
      <Icon name="list-check-2" className="h-3.5 w-3.5 flex-shrink-0 text-primary" aria-hidden="true" />
      <span className="flex-shrink-0 typography-meta text-muted-foreground">
        {t('chat.piPlan.plan')}
      </span>
      <span className="min-w-0 flex-1 truncate typography-meta text-foreground">
        {hint}
      </span>
    </div>
  );
});

PiPlanStatusRow.displayName = 'PiPlanStatusRow';
