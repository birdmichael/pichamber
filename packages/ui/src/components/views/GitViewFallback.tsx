import React from 'react';

import { Skeleton } from '@/components/ui/skeleton';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/utils';

const FILE_ROW_WIDTHS = ['w-[88%]', 'w-[72%]', 'w-[80%]', 'w-[64%]', 'w-[76%]', 'w-[58%]'] as const;

/** Stable Git chrome while the lazy Git view chunk or repository status loads. */
export function GitViewFallback() {
  const { t } = useI18n();
  return (
    <div
      className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-background"
      aria-busy="true"
      aria-live="polite"
      aria-label={t('gitView.loading.checkingRepository')}
    >
      <div className="flex shrink-0 items-center gap-2 border-b border-border/40 px-3 py-2">
        <Skeleton className="h-8 w-28 rounded-md" aria-hidden />
        <Skeleton className="h-8 w-16 rounded-md" aria-hidden />
        <div className="flex-1" />
        <Skeleton className="size-8 rounded-md" aria-hidden />
      </div>
      <div className="flex flex-col gap-3 px-4 pt-3">
        <Skeleton className="h-4 w-20 rounded-md" aria-hidden />
        {FILE_ROW_WIDTHS.map((width) => (
          <div key={width} className="flex items-center gap-2">
            <Skeleton className="size-4 rounded" aria-hidden />
            <Skeleton className={cn('h-4 rounded-md', width)} aria-hidden />
          </div>
        ))}
      </div>
    </div>
  );
}
