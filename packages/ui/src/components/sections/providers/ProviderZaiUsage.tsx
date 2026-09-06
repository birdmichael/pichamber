import React from 'react';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/icon/Icon';
import { SettingsSection } from '@/components/sections/shared/SettingsSection';
import { UsageProgressBar } from '@/components/sections/usage/UsageProgressBar';
import { formatQuotaResetLabel, formatQuotaValueLabel } from '@/lib/quota';
import { formatZaiWindowLabel, presentZaiUsage } from '@/lib/pi/zai-usage';
import { useI18n } from '@/lib/i18n';
import { useZaiUsageStore } from '@/stores/useZaiUsageStore';
import { useUIStore } from '@/stores/useUIStore';
import { cn } from '@/lib/utils';

/**
 * ZAI Code subscription allowance on the Providers card. Mount when this connected provider has credentials.
 */
export const ProviderZaiUsage: React.FC<{ providerId?: string }> = ({ providerId }) => {
  const { t } = useI18n();
  const usageId = providerId?.trim() || 'zai';
  const payload = useZaiUsageStore((state) => state.byId[usageId]?.payload ?? (usageId === 'zai' ? state.payload : null));
  const error = useZaiUsageStore((state) => state.byId[usageId]?.error ?? (usageId === 'zai' ? state.error : null));
  const isLoading = useZaiUsageStore((state) => state.byId[usageId]?.isLoading ?? false);
  const fetchUsage = useZaiUsageStore((state) => state.fetchUsage);
  const timeFormatPreference = useUIStore((state) => state.timeFormatPreference);

  React.useEffect(() => {
    void fetchUsage(usageId);
  }, [fetchUsage, usageId]);

  const windows = payload?.usage?.windows ?? {};
  const rows = Object.entries(windows);
  const expiresLabel = payload?.expires
    ? formatQuotaResetLabel(payload.expires, null, timeFormatPreference)
    : '';
  const presentation = presentZaiUsage({ payload, error, isLoading });
  const status = presentation.kind === 'notConfigured'
    ? t('settings.providers.page.zaiUsage.notConfigured')
    : presentation.kind === 'error'
      ? (presentation.auth
        ? t('settings.providers.page.zaiUsage.refreshFailed')
        : (presentation.message || t('settings.providers.page.zaiUsage.error')))
      : null;
  const showLoading = presentation.kind === 'loading' && rows.length === 0;

  return (
    <SettingsSection
      title={t('settings.providers.page.zaiUsage.title')}
      headerAction={(
        <Button
          size="icon"
          variant="ghost"
          className="size-7 shrink-0 text-muted-foreground"
          onClick={() => void fetchUsage(usageId)}
          aria-label={t('settings.usage.sidebar.actions.refreshAria')}
          title={t('settings.usage.sidebar.actions.refreshTitle')}
          disabled={isLoading}
        >
          <Icon name="refresh" className={cn('size-3.5', isLoading && 'animate-spin')} />
        </Button>
      )}
    >
      {showLoading ? (
        <p className="py-1.5 typography-meta text-muted-foreground">
          {t('settings.providers.page.zaiUsage.loading')}
        </p>
      ) : null}
      {status ? (
        <p className="py-1.5 typography-ui-label text-foreground">{status}</p>
      ) : null}
      {rows.map(([label, window]) => {
        const metric = formatQuotaValueLabel(undefined, window.usedPercent);
        const resetLabel = formatQuotaResetLabel(
          window.resetAt,
          window.resetAfterFormatted ?? window.resetAtFormatted,
          timeFormatPreference,
        );
        return (
          <div key={label} className="flex flex-col gap-1.5 py-1.5">
            <div className="flex min-w-0 items-center justify-between gap-3">
              <div className="min-w-0 flex items-center gap-2">
                <span className="truncate typography-ui-label text-foreground">
                  {formatZaiWindowLabel(label, t)}
                </span>
                {resetLabel ? (
                  <span className="truncate typography-micro text-muted-foreground">
                    {resetLabel}
                  </span>
                ) : null}
              </div>
              <span className="shrink-0 typography-ui-label text-foreground tabular-nums">
                {metric === '-' ? '' : metric}
              </span>
            </div>
            <UsageProgressBar
              percent={window.usedPercent}
              tonePercent={window.usedPercent}
              className="h-1.5"
            />
          </div>
        );
      })}
      {expiresLabel ? (
        <p className="py-1.5 typography-meta text-muted-foreground">
          {t('settings.providers.page.zaiUsage.expires', { time: expiresLabel })}
        </p>
      ) : null}
    </SettingsSection>
  );
};
