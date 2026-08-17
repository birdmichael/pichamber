import React from 'react';

import { useI18n } from '@/lib/i18n';

/** Stable Plan chrome while the lazy Plan view chunk loads. */
export function PlanViewFallback() {
  const { t } = useI18n();
  return (
    <div className="relative flex h-full min-h-0 min-w-0 w-full flex-col overflow-hidden bg-background">
      <div className="flex min-w-0 items-center gap-2 border-b border-border/40 px-3 py-1.5 flex-shrink-0">
        <div className="min-w-0 flex-1">
          <div className="typography-ui-label font-medium truncate">{t('planView.title.default')}</div>
        </div>
      </div>
    </div>
  );
}
