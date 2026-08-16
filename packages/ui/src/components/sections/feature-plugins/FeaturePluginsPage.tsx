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
import { Input } from '@/components/ui/input';
import { toast } from '@/components/ui';
import { SettingsPageLayout } from '@/components/sections/shared/SettingsPageLayout';
import {
  SETTINGS_FIELDS_STACK_CLASS,
  SETTINGS_HELPER_CLASS,
  SettingsCheckboxRow,
  SettingsChipGroup,
  SettingsSection,
  SettingsStackedField,
} from '@/components/sections/shared/SettingsSection';
import { refreshSessionTitleReloadLists } from '@/components/layout/headerSessionReload';
import { useI18n } from '@/lib/i18n';
import { reportSettingsSaveState } from '@/lib/persistence';
import { runtimeFetch } from '@/lib/runtime-fetch';
import {
  FEATURE_PLUGIN_SLOT_COPY,
  FEATURE_PLUGIN_SLOTS,
  type FeaturePluginSlot,
  type FeaturePluginSlotState,
  type FeaturePluginsPayload,
  type FeaturePluginsReloadResult,
  emptyFeaturePluginsPayload,
  parseFeaturePluginsPayload,
  presetSourceLabel,
} from './featurePlugins';

type LoadState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; data: FeaturePluginsPayload };

type PendingAction = {
  slot: FeaturePluginSlot;
  action: 'install' | 'uninstall';
};

const SETTINGS_INPUT_CLASS = 'h-8 rounded-md px-3 font-mono typography-meta';

async function readJson(response: Response): Promise<unknown> {
  return response.json().catch(() => null);
}

export const FeaturePluginsPage: React.FC = () => {
  const { t } = useI18n();
  const [loadState, setLoadState] = React.useState<LoadState>({ status: 'loading' });
  const [drafts, setDrafts] = React.useState<FeaturePluginsPayload>(emptyFeaturePluginsPayload);
  const [pending, setPending] = React.useState<PendingAction | null>(null);
  const [busySlot, setBusySlot] = React.useState<FeaturePluginSlot | null>(null);

  const applyPayload = React.useCallback((payload: FeaturePluginsPayload) => {
    setDrafts(payload);
    setLoadState({ status: 'ready', data: payload });
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

  const persistSlot = React.useCallback(async (
    slot: FeaturePluginSlot,
    patch: Partial<Pick<FeaturePluginSlotState, 'source' | 'enabled' | 'command'>>,
  ) => {
    reportSettingsSaveState('saving');
    try {
      const response = await runtimeFetch('/api/pi/feature-plugins', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ [slot]: patch }),
      });
      const parsed = parseFeaturePluginsPayload(await readJson(response));
      if (!response.ok || !parsed) {
        reportSettingsSaveState('error');
        return;
      }
      applyPayload(parsed);
      reportSettingsSaveState('saved');
    } catch {
      reportSettingsSaveState('error');
    }
  }, [applyPayload]);

  const updateDraft = React.useCallback((
    slot: FeaturePluginSlot,
    patch: Partial<Pick<FeaturePluginSlotState, 'source' | 'command'>>,
  ) => {
    setDrafts((current) => ({
      slots: {
        ...current.slots,
        [slot]: { ...current.slots[slot], ...patch },
      },
    }));
  }, []);

  const runPackageAction = React.useCallback(async (action: PendingAction) => {
    const slot = action.slot;
    const draft = drafts.slots[slot];
    setBusySlot(slot);
    try {
      const response = await runtimeFetch(`/api/pi/feature-plugins/${slot}/${action.action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ source: draft.source }),
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
  }, [applyPayload, drafts.slots, t]);

  const ready = loadState.status === 'ready';

  return (
    <SettingsPageLayout
      title={t('settings.page.featurePlugins.title')}
      description={t('settings.featurePlugins.page.warning')}
      showSaveStatus
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
      {loadState.status === 'loading' ? null : FEATURE_PLUGIN_SLOTS.map((slot, index) => {
        const copy = FEATURE_PLUGIN_SLOT_COPY[slot];
        const draft = drafts.slots[slot];
        const saved = ready ? loadState.data.slots[slot] : draft;
        const selectedPreset = draft.presets.find((preset) => preset.source === draft.source)?.source ?? '';
        const isBusy = busySlot === slot;
        return (
          <SettingsSection
            key={slot}
            title={t(copy.titleKey)}
            info={t(copy.infoKey)}
            divider={index === 0 && loadState.status === 'ready' ? false : undefined}
            settingsItem={copy.settingsItem}
          >
            <div className={SETTINGS_FIELDS_STACK_CLASS}>
              <SettingsStackedField
                label={t('settings.featurePlugins.field.source')}
                info={t('settings.featurePlugins.field.source.info')}
                settingsItem={`${copy.settingsItem}.source`}
                controlClassName="w-full max-w-none"
              >
                <Input
                  value={draft.source}
                  onChange={(event) => updateDraft(slot, { source: event.target.value })}
                  onBlur={() => {
                    if (!ready || draft.source === saved.source) return;
                    void persistSlot(slot, { source: draft.source });
                  }}
                  placeholder={t('settings.featurePlugins.field.source.placeholder')}
                  aria-label={t('settings.featurePlugins.field.source.aria', { slot: t(copy.titleKey) })}
                  className={SETTINGS_INPUT_CLASS}
                  disabled={!ready || isBusy}
                />
              </SettingsStackedField>
              {draft.presets.length > 0 ? (
                <SettingsChipGroup
                  value={selectedPreset}
                  aria-label={t('settings.featurePlugins.presets.aria', { slot: t(copy.titleKey) })}
                  options={draft.presets.map((preset) => ({
                    value: preset.source,
                    label: presetSourceLabel(preset.source),
                  }))}
                  onChange={(source) => {
                    updateDraft(slot, { source });
                    if (ready) void persistSlot(slot, { source });
                  }}
                />
              ) : null}
              {slot === 'goal' ? (
                <SettingsStackedField
                  label={t('settings.featurePlugins.field.command')}
                  info={t('settings.featurePlugins.field.command.info')}
                  settingsItem={`${copy.settingsItem}.command`}
                >
                  <Input
                    value={draft.command ?? ''}
                    onChange={(event) => updateDraft(slot, { command: event.target.value })}
                    onBlur={() => {
                      if (!ready || draft.command === saved.command) return;
                      void persistSlot(slot, { command: draft.command });
                    }}
                    placeholder={t('settings.featurePlugins.field.command.placeholder')}
                    aria-label={t('settings.featurePlugins.field.command.aria')}
                    className={SETTINGS_INPUT_CLASS}
                    disabled={!ready || isBusy}
                  />
                </SettingsStackedField>
              ) : null}
              <p className={SETTINGS_HELPER_CLASS}>
                {saved.installed
                  ? t('settings.featurePlugins.status.installed')
                  : t('settings.featurePlugins.status.notInstalled')}
              </p>
              <SettingsCheckboxRow
                checked={saved.enabled}
                onChange={(enabled) => {
                  updateDraft(slot, {});
                  void persistSlot(slot, { enabled });
                }}
                label={t('settings.featurePlugins.enabled.label')}
                info={t('settings.featurePlugins.enabled.info')}
                ariaLabel={t('settings.featurePlugins.enabled.label')}
                settingsItem={`${copy.settingsItem}.enabled`}
                disabled={!ready || isBusy}
              />
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  disabled={!ready || isBusy || !draft.source.trim()}
                  onClick={() => setPending({ slot, action: 'install' })}
                >
                  {isBusy && pending?.action === 'install'
                    ? t('settings.featurePlugins.actions.installing')
                    : t('settings.featurePlugins.actions.install')}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={!ready || isBusy || !saved.installed}
                  onClick={() => setPending({ slot, action: 'uninstall' })}
                >
                  {isBusy && pending?.action === 'uninstall'
                    ? t('settings.featurePlugins.actions.uninstalling')
                    : t('settings.featurePlugins.actions.uninstall')}
                </Button>
              </div>
            </div>
          </SettingsSection>
        );
      })}

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
