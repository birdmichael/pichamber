import React from 'react';
import { Icon } from '@/components/icon/Icon';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useI18n } from '@/lib/i18n';
import { ProviderLogo } from '@/components/ui/ProviderLogo';
import { preloadProviderLogos } from '@/hooks/useProviderLogo';
import { formatQuotaResetLabel, formatQuotaValueLabel, formatWindowLabel } from '@/lib/quota';
import type { TimeFormatPreference } from '@/stores/useUIStore';
import { useQuotaAutoRefresh, useQuotaStore } from '@/stores/useQuotaStore';
import { useUIStore } from '@/stores/useUIStore';
import { useUsageProviderGroups, type UsageProviderGroup } from '@/components/usage/usageGroups';
import { useConfigStore } from '@/stores/useConfigStore';
import { pickUsageHeadline } from './usageHeadline';
import { runBackgroundNetworkTask } from '@/lib/background-network';
import { WorkStatusRow, WorkStatusCollapsibleSection, WorkStatusValue } from './WorkStatusPrimitives';
import { useReportWorkStatusPresence } from './presenceContext';
import { usePiKernel } from '@/lib/usePiKernel';
import { useXaiUsageStore } from '@/stores/useXaiUsageStore';
import { presentXaiUsage } from '@/lib/pi/xai-usage';
import type { UsageWindow } from '@/types';

/**
 * OpenCode provider rate limits.
 *
 * The mobile popover renders these as filled cards; that language does not
 * survive here — the fills and their padding fight the panel's flat rows and
 * cost roughly twice the height. Only the data is shared
 * (`useUsageProviderGroups`); the presentation is the panel's own row
 * vocabulary, with each provider as a quiet sub-heading.
 *
 * Sits above Subagents and MCP: a spent quota stops the work outright, so it
 * belongs with the readouts that hold for the whole session rather than with
 * whatever happens to be running.
 *
 * On Pi this section mounts only when the Grok Usage feature-plugin slot is
 * on (`isWorkStatusSectionAvailable`). Session context % / cost stay in the
 * Session block.
 */

const windowTone = (window: UsageWindow): 'default' | 'warning' | 'error' => {
  const used = window.usedPercent;
  if (typeof used !== 'number' || !Number.isFinite(used)) return 'default';
  if (used >= 80) return 'error';
  if (used >= 50) return 'warning';
  return 'default';
};

const useXaiUsageGroups = (): UsageProviderGroup[] => {
  const { t } = useI18n();
  const payload = useXaiUsageStore((state) => state.payload);
  const error = useXaiUsageStore((state) => state.error);
  const isLoading = useXaiUsageStore((state) => state.isLoading);
  return React.useMemo(() => {
    const presentation = presentXaiUsage({ payload, error, isLoading });
    if (presentation.kind === 'loading' && !payload?.usage?.windows) return [];
    if (payload && !payload.slotActive) return [];
    const windows = payload?.usage?.windows ?? {};
    const rows = Object.entries(windows).map(([label, window]) => ({
      key: `window-${label}`,
      label: formatWindowLabel(label),
      window,
    }));
    const status = presentation.kind === 'notConfigured'
      ? t('settings.providers.page.xaiUsage.notConfigured')
      : presentation.kind === 'error'
        ? (presentation.auth
          ? t('settings.providers.page.xaiUsage.refreshFailed')
          : (presentation.message || t('settings.providers.page.xaiUsage.error')))
        : rows.length === 0
          ? t('header.services.noRateLimitsReported')
          : null;
    if (presentation.kind === 'loading' && rows.length === 0) return [];
    return [{
      providerId: 'xai',
      providerName: payload?.providerName || 'xAI',
      rows,
      status,
    }];
  }, [error, isLoading, payload, t]);
};

const PiXaiUsageSection: React.FC = () => {
  const { t } = useI18n();
  const groups = useXaiUsageGroups();
  const isLoading = useXaiUsageStore((state) => state.isLoading);
  const fetchUsage = useXaiUsageStore((state) => state.fetchUsage);
  const timeFormatPreference = useUIStore((state) => state.timeFormatPreference);
  const displayMode = useQuotaStore((state) => state.displayMode);

  React.useEffect(() => {
    void runBackgroundNetworkTask(() => fetchUsage());
  }, [fetchUsage]);

  React.useEffect(() => {
    if (groups.length === 0) return;
    preloadProviderLogos(groups.map((group) => group.providerId));
  }, [groups]);

  useReportWorkStatusPresence('usage', groups.length > 0);

  if (groups.length === 0) return null;

  return (
    <UsageSectionBody
      groups={groups}
      displayMode={displayMode}
      isLoading={isLoading}
      onRefresh={() => void fetchUsage()}
      timeFormatPreference={timeFormatPreference}
      currentProviderId="xai"
      modeLabel={displayMode === 'remaining' ? t('header.services.remaining') : t('header.services.used')}
    />
  );
};

const OpenCodeUsageSection: React.FC = () => {
  const { t } = useI18n();
  const groups = useUsageProviderGroups();
  const displayMode = useQuotaStore((state) => state.displayMode);
  const isLoading = useQuotaStore((state) => state.isLoading);
  const quotaResults = useQuotaStore((state) => state.results);
  const dropdownProviderIds = useQuotaStore((state) => state.dropdownProviderIds);
  const fetchQuotas = useQuotaStore((state) => state.fetchQuotas);
  const timeFormatPreference = useUIStore((state) => state.timeFormatPreference);
  const currentProviderId = useConfigStore((state) => state.currentProviderId);

  // Keeps the periodic refresh running while the panel is mounted.
  useQuotaAutoRefresh();

  // `useQuotaAutoRefresh` only schedules an interval — it never performs the
  // first fetch. That was owned by the header dropdown's open handler, so the
  // panel stayed empty until the user opened it. Kick off the initial load for
  // any enabled provider that has not reported yet, background-gated so it
  // cannot compete with chat bootstrap traffic.
  React.useEffect(() => {
    if (isLoading || dropdownProviderIds.length === 0) return;
    const missingProvider = dropdownProviderIds.some(
      (providerId) => !quotaResults.some((result) => result.providerId === providerId),
    );
    if (!missingProvider) return;
    void runBackgroundNetworkTask(() => fetchQuotas(dropdownProviderIds));
  }, [dropdownProviderIds, fetchQuotas, isLoading, quotaResults]);

  React.useEffect(() => {
    if (groups.length === 0) return;
    preloadProviderLogos(groups.map((group) => group.providerId));
  }, [groups]);

  useReportWorkStatusPresence('usage', groups.length > 0);

  if (groups.length === 0) return null;

  return (
    <UsageSectionBody
      groups={groups}
      displayMode={displayMode}
      isLoading={isLoading}
      onRefresh={() => void fetchQuotas(dropdownProviderIds)}
      timeFormatPreference={timeFormatPreference}
      currentProviderId={currentProviderId}
      modeLabel={displayMode === 'remaining' ? t('header.services.remaining') : t('header.services.used')}
    />
  );
};

const UsageSectionBody: React.FC<{
  groups: UsageProviderGroup[];
  displayMode: 'usage' | 'remaining';
  isLoading: boolean;
  onRefresh: () => void;
  timeFormatPreference: TimeFormatPreference;
  currentProviderId: string | null;
  modeLabel: string;
}> = ({
  groups,
  displayMode,
  isLoading,
  onRefresh,
  timeFormatPreference,
  currentProviderId,
  modeLabel,
}) => {
  const { t } = useI18n();
  const headline = pickUsageHeadline(groups, currentProviderId);
  const headlineMetric = headline
    ? formatQuotaValueLabel(
      headline.row.window.valueLabel,
      displayMode === 'remaining' ? headline.row.window.remainingPercent : headline.row.window.usedPercent,
    )
    : null;

  return (
    <WorkStatusCollapsibleSection
      id="usage"
      title={t('chat.workStatus.section.usage')}
      icon="timer"
      summary={(
        <span className="inline-flex items-center gap-1.5">
          {headline && headlineMetric && headlineMetric !== '-' ? (
            <>
              <span className="truncate">{headline.row.label}</span>
              <WorkStatusValue tone={windowTone(headline.row.window)}>{headlineMetric}</WorkStatusValue>
            </>
          ) : modeLabel}
        </span>
      )}
      action={(
        <Button
          size="icon"
          variant="ghost"
          className="size-6 shrink-0 text-muted-foreground"
          onClick={onRefresh}
          aria-label={t('settings.usage.sidebar.actions.refreshAria')}
          title={t('settings.usage.sidebar.actions.refreshTitle')}
          disabled={isLoading}
        >
          <Icon name="refresh" className={cn('size-3.5', isLoading && 'animate-spin')} />
        </Button>
      )}
    >
      {groups.map((group) => (
        <React.Fragment key={group.providerId}>
          <WorkStatusRow
            leading={<ProviderLogo providerId={group.providerId} className="size-4 shrink-0" />}
            label={group.providerName}
            muted
            value={group.status ? (
              <WorkStatusValue tone="muted">{group.status}</WorkStatusValue>
            ) : undefined}
          />
          {group.rows.map((row) => {
            const displayPercent = displayMode === 'remaining'
              ? row.window.remainingPercent
              : row.window.usedPercent;
            const metricLabel = formatQuotaValueLabel(row.window.valueLabel, displayPercent);
            const resetLabel = formatQuotaResetLabel(
              row.window.resetAt,
              row.window.resetAfterFormatted ?? row.window.resetAtFormatted,
              timeFormatPreference,
            );
            return (
              <WorkStatusRow
                key={`${group.providerId}-${row.key}`}
                label={(
                  <span className="inline-flex min-w-0 items-baseline gap-1.5">
                    <span className="truncate">
                      {row.subtitle ? `${row.subtitle} · ${row.label}` : row.label}
                    </span>
                    {resetLabel ? (
                      <span className="shrink-0 text-[11px] text-muted-foreground">{resetLabel}</span>
                    ) : null}
                  </span>
                )}
                value={metricLabel === '-' ? undefined : (
                  <WorkStatusValue tone={windowTone(row.window)}>{metricLabel}</WorkStatusValue>
                )}
              />
            );
          })}
        </React.Fragment>
      ))}
    </WorkStatusCollapsibleSection>
  );
};

export const WorkStatusUsageSection: React.FC = () => (
  usePiKernel() ? <PiXaiUsageSection /> : <OpenCodeUsageSection />
);
