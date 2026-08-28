import React from 'react';

import { Icon } from '@/components/icon/Icon';
import { useI18n } from '@/lib/i18n';
import { readPiGoalObjectiveFromSession } from '@/lib/piGoal';
import { usePiKernel } from '@/lib/usePiKernel';
import { cn } from '@/lib/utils';
import { useDirectorySync } from '@/sync/sync-context';

interface PiGoalStatusRowProps {
  sessionId: string | null;
  directory?: string;
  className?: string;
}

export const PiGoalStatusRow: React.FC<PiGoalStatusRowProps> = React.memo(({
  sessionId,
  directory,
  className,
}) => {
  const { t } = useI18n();
  const isPiKernel = usePiKernel();
  const objective = useDirectorySync((state) => {
    if (!sessionId) return null;
    return readPiGoalObjectiveFromSession(state.message[sessionId], state.part);
  }, directory);

  if (!isPiKernel || !sessionId || !objective) return null;

  return (
    <div
      className={cn(
        'flex w-full min-w-0 items-center gap-2 rounded-lg border px-2 py-1',
        'border-[var(--interactive-border)]',
        className,
      )}
      aria-label={t('chat.piGoal.row.aria')}
      title={objective}
    >
      <Icon name="target" className="h-3.5 w-3.5 flex-shrink-0 text-primary" aria-hidden="true" />
      <span className="flex-shrink-0 typography-meta text-muted-foreground">
        {t('chat.piGoal.row.label')}
      </span>
      <span className="min-w-0 flex-1 truncate typography-meta text-foreground">
        {objective}
      </span>
    </div>
  );
});

PiGoalStatusRow.displayName = 'PiGoalStatusRow';
