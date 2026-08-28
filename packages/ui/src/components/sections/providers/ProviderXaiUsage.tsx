import React from 'react';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/icon/Icon';
import { SettingsSection } from '@/components/sections/shared/SettingsSection';
import { formatQuotaResetLabel, formatQuotaValueLabel, formatWindowLabel } from '@/lib/quota';
import { presentXaiUsage } from '@/lib/pi/xai-usage';
import { useI18n } from '@/lib/i18n';
import { useXaiUsageStore } from '@/stores/useXaiUsageStore';
import { useUIStore } from '@/stores/useUIStore';
import { cn } from '@/lib/utils';

/**
 * xAI subscription allowance on the Providers card. Only mount when the
 * Grok Usage feature-plugin slot is on and this provider is connected.
 */
export const ProviderXaiUsage: React.FC = () => {
  const { t } = useI18n();
  const payload = useXaiUsageStore((state) => state.payload);
  const error = useXaiUsageStore((state) => state.error);
  const isLoading = useXaiUsageStore((state) => state.isLoading);
  const fetchUsage = useXaiUsageStore((state) => state.fetchUsage);
  const timeFormatPreference = useUIStore((state) => state.timeFormatPreference);

  React.useEffect(() => {
    void fetchUsage();
  }, [fetchUsage]);

  const windows = payload?.usage?.windows ?? {};
  const rows = Object.entries(windows);
  const expiresLabel = payload?.expires
    ? formatQuotaResetLabel(payload.expires, null, timeFormatPreference)
    : '';
  const presentation = presentXaiUsage({ payload, error, isLoading });
  const status = presentation.kind === 'notConfigured'
    ? t('settings.providers.page.xaiUsage.notConfigured')
    : presentation.kind === 'error'
      ? (presentation.auth
        ? t('settings.providers.page.xaiUsage.refreshFailed')
        : (presentation.message || t('settings.providers.page.xaiUsage.error')))
      : null;
  const showLoading = presentation.kind === 'loading' && rows.length === 0;

  return (
    <SettingsSection
      title={t('settings.providers.page.xaiUsage.title')}
      headerAction={(
        <Button
          size="icon"
          variant="ghost"
          className="size-7 shrink-0 text-muted-foreground"
          onClick={() => void fetchUsage()}
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
          {t('settings.providers.page.xaiUsage.loading')}
        </p>
      ) : null}
      {status ? (
        <p className="py-1.5 typography-ui-label text-foreground">{status}</p>
      ) : null}
      {rows.map(([label, window]) => {
        const metric = formatQuotaValueLabel(window.valueLabel, window.usedPercent);
        const resetLabel = formatQuotaResetLabel(
          window.resetAt,
          window.resetAfterFormatted ?? window.resetAtFormatted,
          timeFormatPreference,
        );
        return (
          <div key={label} className="flex items-baseline justify-between gap-3 py-1.5">
            <span className="min-w-0 truncate typography-ui-label text-foreground">
              {formatWindowLabel(label)}
              {resetLabel ? (
                <span className="ml-1.5 typography-meta text-muted-foreground">{resetLabel}</span>
              ) : null}
            </span>
            {metric !== '-' ? (
              <span className="shrink-0 typography-ui-label text-foreground">{metric}</span>
            ) : null}
          </div>
        );
      })}
      {expiresLabel ? (
        <p className="py-1.5 typography-meta text-muted-foreground">
          {t('settings.providers.page.xaiUsage.expires', { time: expiresLabel })}
        </p>
      ) : null}
    </SettingsSection>
  );
};
