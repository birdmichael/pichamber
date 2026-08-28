import React from 'react';

import { Icon } from '@/components/icon/Icon';
import { useI18n } from '@/lib/i18n';
import {
  readPiGoalObjectiveFromSession,
  readPiGoalRouteSessionID,
  resolvePiGoalTargetSession,
} from '@/lib/piGoal';
import { getRuntimeKey } from '@/lib/runtime-switch';
import { usePiKernel } from '@/lib/usePiKernel';
import { cn } from '@/lib/utils';
import { readLastActiveSession } from '@/sync/last-session-cache';
import { useSessionUIStore } from '@/sync/session-ui-store';
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
  const currentSessionId = useSessionUIStore((state) => state.currentSessionId);
  const routeSessionID = typeof window === 'undefined'
    ? ''
    : readPiGoalRouteSessionID(window.location.search);
  const lastActiveSessionID = readLastActiveSession(getRuntimeKey())?.sessionId ?? '';
  const resolvedSessionId = resolvePiGoalTargetSession({
    sessionID: sessionId,
    currentSessionID: currentSessionId,
    routeSessionID,
    lastActiveSessionID,
  }) || null;
  const objective = useDirectorySync((state) => {
    if (!resolvedSessionId) return null;
    return readPiGoalObjectiveFromSession(state.message[resolvedSessionId], state.part);
  }, directory);

  if (!isPiKernel || !resolvedSessionId || !objective) return null;

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
