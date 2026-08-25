import React from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { toast } from '@/components/ui';
import { SettingsPageLayout } from '@/components/sections/shared/SettingsPageLayout';
import {
  SETTINGS_HELPER_CLASS,
  SettingsSection,
} from '@/components/sections/shared/SettingsSection';
import { refreshSessionTitleReloadLists } from '@/components/layout/headerSessionReload';
import { useI18n } from '@/lib/i18n';
import { runtimeFetch } from '@/lib/runtime-fetch';
import { cn } from '@/lib/utils';
import { useFeaturePluginsStore } from '@/stores/useFeaturePluginsStore';
import { useFeaturePluginSlotsStore } from '@/stores/useFeaturePluginSlotsStore';
import { applyFeaturePluginsPayload } from '@/sync/pi-feature-plugins-store';
import {
  DEFAULT_FEATURE_PLUGIN_SOURCES,
  FEATURE_PLUGIN_SLOT_COPY,
  FEATURE_PLUGIN_SLOTS,
  type FeaturePluginSlot,
  type FeaturePluginSlotState,
  type FeaturePluginsPayload,
  type FeaturePluginsReloadResult,
  emptyFeaturePluginsPayload,
  featurePluginPackageLabel,
  parseFeaturePluginsPayload,
} from './featurePlugins';

type LoadState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; data: FeaturePluginsPayload };

type PendingAction = {
  slot: FeaturePluginSlot;
  action: 'install' | 'uninstall';
};

async function readJson(response: Response): Promise<unknown> {
  return response.json().catch(() => null);
}

/** Catalog of six fixed slots. Do not copy these boxed cards onto General / Appearance / Chat. */
export const FeaturePluginsPage: React.FC = () => {
  const { t } = useI18n();
  const [loadState, setLoadState] = React.useState<LoadState>({ status: 'loading' });
  const [pending, setPending] = React.useState<PendingAction | null>(null);
  const [busySlot, setBusySlot] = React.useState<FeaturePluginSlot | null>(null);

  const applyPayload = React.useCallback((payload: FeaturePluginsPayload) => {
    setLoadState({ status: 'ready', data: payload });
    applyFeaturePluginsPayload(payload);
    useFeaturePluginsStore.getState().applyPayload(payload);
    useFeaturePluginSlotsStore.getState().apply(payload);
  }, []);

  const loadPlugins = React.useCallback(async () => {
    try {
      const response = await runtimeFetch('/api/pi/feature-plugins', {
        headers: { Accept: 'application/json' },
      });
      const parsed = parseFeaturePluginsPayload(await readJson(response));
      if (!response.ok || !parsed) {
        setLoadState((current) => (current.status === 'ready' ? current : { status: 'error' }));
        return;
      }
      applyPayload(parsed);
    } catch {
      setLoadState((current) => (current.status === 'ready' ? current : { status: 'error' }));
    }
  }, [applyPayload]);

  React.useEffect(() => {
    void loadPlugins();
  }, [loadPlugins]);

  const runPackageAction = React.useCallback(async (action: PendingAction) => {
    const slot = action.slot;
    setBusySlot(slot);
    try {
      const response = await runtimeFetch(`/api/pi/feature-plugins/${slot}/${action.action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ source: DEFAULT_FEATURE_PLUGIN_SOURCES[slot] }),
      });
      const raw = await readJson(response) as (FeaturePluginsPayload & { reload?: FeaturePluginsReloadResult; error?: string }) | null;
      const parsed = parseFeaturePluginsPayload(raw);
      if (!response.ok || !parsed) {
        toast.error(action.action === 'install'
          ? t('settings.featurePlugins.toast.installFailed')
          : t('settings.featurePlugins.toast.uninstallFailed'));
        return;
      }
      applyPayload(parsed);
      await refreshSessionTitleReloadLists();
      if ((raw?.reload?.skipped?.length ?? 0) > 0) {
        toast.error(t('settings.featurePlugins.toast.reloadPartial'));
      }
    } catch {
      toast.error(action.action === 'install'
        ? t('settings.featurePlugins.toast.installFailed')
        : t('settings.featurePlugins.toast.uninstallFailed'));
    } finally {
      setBusySlot(null);
      setPending(null);
    }
  }, [applyPayload, t]);

  const ready = loadState.status === 'ready';
  const payload = ready ? loadState.data : emptyFeaturePluginsPayload();

  return (
    <SettingsPageLayout
      title={t('settings.page.featurePlugins.title')}
      description={t('settings.featurePlugins.page.warning')}
    >
      {loadState.status === 'loading' ? (
        <SettingsSection divider={false}>
          <p className={SETTINGS_HELPER_CLASS}>{t('settings.featurePlugins.page.loading')}</p>
        </SettingsSection>
      ) : null}
      {loadState.status === 'error' ? (
        <SettingsSection divider={false}>
          <p className={SETTINGS_HELPER_CLASS}>{t('settings.featurePlugins.page.loadFailed')}</p>
        </SettingsSection>
      ) : null}
      {loadState.status === 'loading' ? null : (
        <SettingsSection
          divider={loadState.status !== 'error' ? false : undefined}
          contentClassName="grid grid-cols-1 items-stretch gap-3 @xl:grid-cols-2"
        >
          {FEATURE_PLUGIN_SLOTS.map((slot) => (
            <FeaturePluginCard
              key={slot}
              slot={slot}
              saved={payload.slots[slot]}
              ready={ready}
              isBusy={busySlot === slot}
              pendingAction={pending?.slot === slot ? pending.action : null}
              onInstall={() => {
                if (payload.slots[slot].installed) return;
                setPending({ slot, action: 'install' });
              }}
              onUninstall={() => setPending({ slot, action: 'uninstall' })}
            />
          ))}
        </SettingsSection>
      )}

      <Dialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open && busySlot == null) setPending(null);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {pending?.action === 'uninstall'
                ? t('settings.featurePlugins.dialog.uninstall.title')
                : t('settings.featurePlugins.dialog.install.title')}
            </DialogTitle>
            <DialogDescription>
              {pending?.action === 'uninstall'
                ? t('settings.featurePlugins.dialog.uninstall.description')
                : t('settings.featurePlugins.dialog.install.description')}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setPending(null)}
              disabled={busySlot != null}
            >
              {t('settings.common.actions.cancel')}
            </Button>
            <Button
              size="sm"
              variant={pending?.action === 'uninstall' ? 'destructive' : 'default'}
              onClick={() => {
                if (pending) void runPackageAction(pending);
              }}
              disabled={busySlot != null || pending == null}
            >
              {pending?.action === 'uninstall'
                ? t('settings.featurePlugins.actions.uninstall')
                : t('settings.featurePlugins.actions.install')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SettingsPageLayout>
  );
};

function FeaturePluginCard({
  slot,
  saved,
  ready,
  isBusy,
  pendingAction,
  onInstall,
  onUninstall,
}: {
  slot: FeaturePluginSlot;
  saved: FeaturePluginSlotState;
  ready: boolean;
  isBusy: boolean;
  pendingAction: PendingAction['action'] | null;
  onInstall: () => void;
  onUninstall: () => void;
}) {
  const { t } = useI18n();
  const copy = FEATURE_PLUGIN_SLOT_COPY[slot];

  return (
    <div
      data-settings-item={copy.settingsItem}
      className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-[var(--interactive-border)] bg-[var(--surface-elevated)]"
    >
      <div className="flex min-w-0 items-start gap-3 px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-foreground">{t(copy.titleKey)}</div>
          <p className="mt-0.5 line-clamp-2 text-xs leading-snug text-muted-foreground">
            {t(copy.infoKey)}
          </p>
          <p className="typography-meta mt-2 font-mono text-muted-foreground">
            {featurePluginPackageLabel(slot)}
          </p>
        </div>
        <span
          aria-live="polite"
          className={cn(
            'max-w-36 shrink-0 truncate rounded-full px-2 py-0.5 text-[10px] font-medium',
            saved.installed
              ? 'bg-[var(--status-success)]/15 text-[var(--status-success)]'
              : 'bg-[var(--surface-muted)] text-muted-foreground',
          )}
        >
          {saved.installed
            ? t('settings.featurePlugins.status.installed')
            : t('settings.featurePlugins.status.notInstalled')}
        </span>
      </div>
      <div className="mt-auto space-y-3 border-t border-[var(--interactive-border)] px-4 py-4">
        <div className="flex flex-wrap items-center gap-2">
          {saved.installed ? null : (
            <Button
              type="button"
              size="sm"
              disabled={!ready || isBusy}
              onClick={onInstall}
            >
              {isBusy && pendingAction === 'install'
                ? t('settings.featurePlugins.actions.installing')
                : t('settings.featurePlugins.actions.install')}
            </Button>
          )}
          {saved.installed ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={!ready || isBusy}
              onClick={onUninstall}
            >
              {isBusy && pendingAction === 'uninstall'
                ? t('settings.featurePlugins.actions.uninstalling')
                : t('settings.featurePlugins.actions.uninstall')}
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
