import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Icon } from '@/components/icon/Icon';
import {
  SettingsSection,
  SettingsFieldRow,
  SettingsCheckboxRow,
  SettingsInset,
  SETTINGS_ICON_BUTTON_CLASS,
  SETTINGS_OPTION_STACK_CLASS,
  SETTINGS_DESCRIPTION_CLASS,
  SETTINGS_HELPER_CLASS,
} from '@/components/sections/shared/SettingsSection';
import { canRequestNativeDirectoryAccess, requestDirectoryAccess } from '@/lib/desktop';
import { updateDesktopSettings } from '@/lib/persistence';
import { reloadOpenCodeConfiguration } from '@/stores/useAgentsStore';
import { useUIStore } from '@/stores/useUIStore';
import { useI18n } from '@/lib/i18n';
import { runtimeFetch } from '@/lib/runtime-fetch';
import { toast } from '@/components/ui';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  canUpdatePiFromStatus,
  isPiUpToDate,
  parsePiUpgradeStatus,
  shouldShowPiLatestVersion,
  type PiUpgradeStatus,
} from './piAgentUpdate';

type LoadState = 'loading' | 'error' | 'ready';

const unwrapPath = (value: string): string => {
  const trimmed = value.trim();
  if (trimmed.length >= 2
    && ((trimmed.startsWith('"') && trimmed.endsWith('"'))
      || (trimmed.startsWith("'") && trimmed.endsWith("'")))) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
};

export const PiAgentSettings: React.FC = () => {
  const { t } = useI18n();
  const [value, setValue] = React.useState('');
  const [savedValue, setSavedValue] = React.useState('');
  const [resolvedPath, setResolvedPath] = React.useState('');
  const [loadState, setLoadState] = React.useState<LoadState>('loading');
  const [isSaving, setIsSaving] = React.useState(false);
  const [upgradeStatus, setUpgradeStatus] = React.useState<PiUpgradeStatus | null>(null);
  const [isUpdating, setIsUpdating] = React.useState(false);
  const showOpenCodeUpdateNotifications = useUIStore((state) => state.showOpenCodeUpdateNotifications);
  const setShowOpenCodeUpdateNotifications = useUIStore((state) => state.setShowOpenCodeUpdateNotifications);
  const canBrowse = canRequestNativeDirectoryAccess();
  const fieldDisabled = loadState !== 'ready' || isSaving;

  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await runtimeFetch('/api/config/settings', {
          method: 'GET',
          headers: { Accept: 'application/json' },
        });
        if (!response.ok) {
          if (!cancelled) setLoadState('error');
          return;
        }
        const data = (await response.json().catch(() => null)) as null | {
          piAgentDir?: unknown;
          piAgentDirResolved?: unknown;
        };
        if (cancelled) return;
        if (!data) {
          setLoadState('error');
          return;
        }
        const nextValue = typeof data.piAgentDir === 'string' ? data.piAgentDir.trim() : '';
        setValue(nextValue);
        setSavedValue(nextValue);
        setResolvedPath(typeof data.piAgentDirResolved === 'string' ? data.piAgentDirResolved.trim() : '');
        setLoadState('ready');
      } catch {
        if (!cancelled) setLoadState('error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const loadUpgradeStatus = React.useCallback(async () => {
    const response = await runtimeFetch('/api/pi/upgrade-status', {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) return null;
    return parsePiUpgradeStatus(await response.json().catch(() => null));
  }, []);

  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const next = await loadUpgradeStatus();
        if (!cancelled) setUpgradeStatus(next);
      } catch {
        if (!cancelled) setUpgradeStatus(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadUpgradeStatus]);

  const handleBrowse = React.useCallback(async () => {
    if (!canRequestNativeDirectoryAccess()) {
      return;
    }
    try {
      const selected = await requestDirectoryAccess(value.trim() || resolvedPath || '', {
        title: t('settings.openchamber.piAgent.dialog.selectDirectory'),
      });
      if (selected.success && selected.path && selected.path.trim().length > 0) {
        setValue(selected.path.trim());
      }
    } catch {
      // Cancel leaves the field unchanged.
    }
  }, [resolvedPath, t, value]);

  const isDirty = unwrapPath(value) !== unwrapPath(savedValue);

  const handleSaveAndReload = React.useCallback(async () => {
    if (loadState !== 'ready' || !isDirty) return;
    setIsSaving(true);
    try {
      const unquoted = unwrapPath(value);
      const response = await runtimeFetch('/api/config/settings', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ piAgentDir: unquoted }),
      });
      const payload = await response.json().catch(() => null) as null | {
        error?: unknown;
        piAgentDir?: unknown;
        piAgentDirResolved?: unknown;
      };
      if (!response.ok) {
        const message = typeof payload?.error === 'string' && payload.error.trim()
          ? payload.error
          : t('settings.openchamber.piAgent.toast.saveFailed');
        toast.error(message);
        return;
      }
      // Empty stays empty: do not write the resolved default into the field.
      const nextValue = unquoted.length === 0
        ? ''
        : (typeof payload?.piAgentDir === 'string' ? payload.piAgentDir.trim() : unquoted);
      setValue(nextValue);
      setSavedValue(nextValue);
      if (typeof payload?.piAgentDirResolved === 'string') {
        setResolvedPath(payload.piAgentDirResolved.trim());
      }
      try {
        await reloadOpenCodeConfiguration({
          message: t('settings.openchamber.piAgent.actions.reloading'),
        });
      } catch (error) {
        const status = (error as Error & { status?: number })?.status;
        if (status === 409) {
          toast.error(t('settings.openchamber.piAgent.toast.reloadBusy'));
          return;
        }
        const message = error instanceof Error && error.message
          ? error.message
          : t('settings.openchamber.piAgent.toast.reloadFailed');
        toast.error(message);
      }
    } catch (error) {
      const message = error instanceof Error && error.message
        ? error.message
        : t('settings.openchamber.piAgent.toast.saveFailed');
      toast.error(message);
    } finally {
      setIsSaving(false);
    }
  }, [isDirty, loadState, t, value]);

  const handleShowUpdateNotificationsChange = React.useCallback((enabled: boolean) => {
    setShowOpenCodeUpdateNotifications(enabled);
    void updateDesktopSettings({ showOpenCodeUpdateNotifications: enabled });
  }, [setShowOpenCodeUpdateNotifications]);

  const handleUpdatePi = React.useCallback(async () => {
    if (isUpdating || !canUpdatePiFromStatus(upgradeStatus)) return;
    setIsUpdating(true);
    try {
      const response = await runtimeFetch('/api/pi/upgrade', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({}),
      });
      const payload = await response.json().catch(() => null) as null | {
        error?: unknown;
        currentVersion?: unknown;
        latestVersion?: unknown;
        available?: unknown;
        reload?: { status?: unknown };
      };
      if (!response.ok) {
        if (response.status === 409) {
          toast.error(t('settings.openchamber.piAgent.toast.updateBusy'));
          return;
        }
        const message = typeof payload?.error === 'string' && payload.error.trim()
          ? payload.error
          : t('settings.openchamber.piAgent.toast.updateFailed');
        toast.error(message);
        return;
      }
      const next = parsePiUpgradeStatus(payload) || await loadUpgradeStatus();
      if (next) setUpgradeStatus(next);
      const version = next?.currentVersion;
      toast.success(version
        ? t('settings.openchamber.piAgent.toast.updateSuccess', { version })
        : t('settings.openchamber.piAgent.toast.updateSuccessNoVersion'));
      const reloadStatus = Number(payload?.reload?.status);
      if (reloadStatus === 409) {
        toast.error(t('settings.openchamber.piAgent.toast.reloadBusy'));
        return;
      }
      try {
        await reloadOpenCodeConfiguration({
          message: t('settings.openchamber.piAgent.actions.reloading'),
        });
      } catch (error) {
        const status = (error as Error & { status?: number })?.status;
        if (status === 409) {
          toast.error(t('settings.openchamber.piAgent.toast.reloadBusy'));
          return;
        }
        const message = error instanceof Error && error.message
          ? error.message
          : t('settings.openchamber.piAgent.toast.reloadFailed');
        toast.error(message);
      }
    } catch (error) {
      const message = error instanceof Error && error.message
        ? error.message
        : t('settings.openchamber.piAgent.toast.updateFailed');
      toast.error(message);
    } finally {
      setIsUpdating(false);
    }
  }, [isUpdating, loadUpgradeStatus, t, upgradeStatus]);

  return (
    <SettingsSection title={t('settings.openchamber.piAgent.title')}>
      <div className="space-y-0.5">
        <SettingsFieldRow
          settingsItem="sessions.pi-agent-directory"
          label={t('settings.openchamber.piAgent.field.directory')}
          info={resolvedPath
            ? t('settings.openchamber.piAgent.field.directoryInfoWithPath', { path: resolvedPath })
            : t('settings.openchamber.piAgent.field.directoryInfo')}
          alignEnd={false}
          controlClassName="@xl:w-[20rem]"
        >
          <Input
            value={loadState === 'ready' ? value : ''}
            onChange={(e) => setValue(e.target.value)}
            placeholder={t('settings.openchamber.piAgent.field.directoryPlaceholder')}
            disabled={fieldDisabled}
            className="h-8 min-w-0 flex-1 font-mono text-xs"
            aria-invalid={loadState === 'error'}
            aria-label={t('settings.openchamber.piAgent.field.directoryAria')}
          />
          {canBrowse ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  onClick={handleBrowse}
                  disabled={fieldDisabled}
                  className={SETTINGS_ICON_BUTTON_CLASS}
                  aria-label={t('settings.openchamber.piAgent.actions.browseAria')}
                >
                  <Icon name="folder" className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent sideOffset={8}>
                {t('settings.openchamber.piAgent.actions.browse')}
              </TooltipContent>
            </Tooltip>
          ) : null}
        </SettingsFieldRow>
        {loadState === 'error' ? (
          <p className={SETTINGS_DESCRIPTION_CLASS} role="alert">
            {t('settings.openchamber.piAgent.error.loadFailed')}
          </p>
        ) : null}

        {upgradeStatus?.currentVersion ? (
          <SettingsFieldRow
            settingsItem="sessions.pi-version"
            label={t('settings.openchamber.piAgent.field.currentVersion')}
            info={t('settings.openchamber.piAgent.field.versionInfo')}
          >
            <span
              className={`${SETTINGS_HELPER_CLASS} font-mono`}
              aria-label={t('settings.openchamber.piAgent.field.currentVersionAria')}
            >
              {upgradeStatus.currentVersion}
            </span>
          </SettingsFieldRow>
        ) : null}
        {shouldShowPiLatestVersion(upgradeStatus) ? (
          <SettingsFieldRow
            settingsItem="sessions.pi-latest-version"
            label={t('settings.openchamber.piAgent.field.latestVersion')}
          >
            <span
              className={`${SETTINGS_HELPER_CLASS} font-mono`}
              aria-label={t('settings.openchamber.piAgent.field.latestVersionAria')}
            >
              {upgradeStatus?.latestVersion}
            </span>
          </SettingsFieldRow>
        ) : null}

        <SettingsInset className={SETTINGS_OPTION_STACK_CLASS}>
          <SettingsCheckboxRow
            settingsItem="sessions.pi-update-notifications"
            checked={showOpenCodeUpdateNotifications}
            onChange={handleShowUpdateNotificationsChange}
            label={t('settings.openchamber.piAgent.field.showUpdateNotifications')}
            ariaLabel={t('settings.openchamber.piAgent.field.showUpdateNotificationsAria')}
            info={t('settings.openchamber.piAgent.field.showUpdateNotificationsInfo')}
          />

          <div className="flex justify-start gap-2 py-1.5" data-settings-item="sessions.pi-update">
            {canUpdatePiFromStatus(upgradeStatus) ? (
              <Button
                type="button"
                size="xs"
                variant="default"
                onClick={handleUpdatePi}
                disabled={isUpdating}
                className="shrink-0 !font-normal"
                aria-label={t('settings.openchamber.piAgent.actions.updateAria')}
              >
                {isUpdating
                  ? t('settings.openchamber.piAgent.actions.updating')
                  : t('settings.openchamber.piAgent.actions.update')}
              </Button>
            ) : isPiUpToDate(upgradeStatus) ? (
              <Button
                type="button"
                size="xs"
                variant="outline"
                disabled
                className="shrink-0 !font-normal"
              >
                {t('settings.openchamber.piAgent.actions.upToDate')}
              </Button>
            ) : null}
            <Button
              type="button"
              size="xs"
              variant={isDirty ? 'default' : 'outline'}
              onClick={handleSaveAndReload}
              disabled={fieldDisabled || !isDirty}
              className="shrink-0 !font-normal"
            >
              {isSaving ? t('settings.common.actions.saving') : t('settings.common.actions.saveChanges')}
            </Button>
          </div>
        </SettingsInset>
      </div>
    </SettingsSection>
  );
};
