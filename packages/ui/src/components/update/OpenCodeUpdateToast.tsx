import * as React from 'react';
import { Icon } from '@/components/icon/Icon';
import { toast } from '@/components/ui/toast';
import { reloadOpenCodeConfiguration } from '@/stores/useAgentsStore';
import { useUIStore } from '@/stores/useUIStore';
import { useI18n } from '@/lib/i18n';
import { runtimeFetch } from '@/lib/runtime-fetch';
import { usePiKernel } from '@/lib/usePiKernel';
import { getRuntimeKey, subscribeRuntimeEndpointChanged } from '@/lib/runtime-switch';
import { updateDesktopSettings } from '@/lib/persistence';
import { getDeferredSafeStorage } from '@/stores/utils/safeStorage';
import { OpenCodeUpdateBanner } from './OpenCodeUpdateBanner';
import {
  dismissOpenCodeUpdateToast,
  resolveDismissedOpenCodeUpdateVersion,
  resolveOpenCodeUpdateVersion,
  resolveOpenCodeUpgradeStatusVersion,
  shouldShowOpenCodeUpdateToast,
  type OpenCodeUpgradeStatusLike,
} from './openCodeUpdateDedup';

const UPDATE_TOAST_ID = 'opencode-update-available';
const UPGRADE_TOAST_ID = 'opencode-upgrade-progress';
const INITIAL_CHECK_DELAY_MS = 5_000;
const CHECK_RETRY_DELAYS_MS = [10_000, 60_000];
const UPDATE_TOAST_DISMISSED_VERSION_KEY = 'opencode-update-toast-dismissed-version';

const persistDismissedVersion = (dismissedVersion: string) => {
  getDeferredSafeStorage().setItem(UPDATE_TOAST_DISMISSED_VERSION_KEY, dismissedVersion);
  void updateDesktopSettings({ openCodeUpdateToastDismissedVersion: dismissedVersion });
};

export const OpenCodeUpdateToast: React.FC = () => {
  const { t } = useI18n();
  const isPiKernel = usePiKernel();
  const showOpenCodeUpdateNotifications = useUIStore((state) => state.showOpenCodeUpdateNotifications);
  const seenVersionsRef = React.useRef(new Set<string>());
  const upgradingRef = React.useRef(false);
  const [availableVersion, setAvailableVersion] = React.useState<string | null>(null);

  const hideAvailableBanner = React.useCallback(() => {
    setAvailableVersion(null);
    // Clear any leftover Infinity sonner pill from older builds.
    toast.dismiss(UPDATE_TOAST_ID);
  }, []);

  React.useEffect(() => {
    if (!showOpenCodeUpdateNotifications) {
      hideAvailableBanner();
    }
  }, [hideAvailableBanner, showOpenCodeUpdateNotifications]);

  const dismissAvailableBanner = React.useCallback((version: string) => {
    dismissOpenCodeUpdateToast({
      version,
      persistDismissedVersion,
      hideToast: hideAvailableBanner,
    });
  }, [hideAvailableBanner]);

  const reloadOpenCode = React.useCallback(() => {
    toast.dismiss(UPGRADE_TOAST_ID);
    void reloadOpenCodeConfiguration({
      message: t('opencodeUpdate.toast.reload.message'),
      mode: 'projects',
      scopes: ['all'],
    }).catch(() => undefined);
  }, [t]);

  const runUpgrade = React.useCallback(async () => {
    if (isPiKernel || upgradingRef.current) return;
    upgradingRef.current = true;
    hideAvailableBanner();
    toast.message(t('opencodeUpdate.toast.upgrading.title'), {
      id: UPGRADE_TOAST_ID,
      description: t('opencodeUpdate.toast.upgrading.description'),
      duration: Infinity,
      icon: <Icon name="refresh" className="h-4 w-4 animate-spin text-muted-foreground" />,
    });

    try {
      const response = await runtimeFetch('/api/opencode/upgrade', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({}),
      });
      const payload = await response.json().catch(() => null) as null | { success?: boolean; version?: string; error?: string };
      if (!response.ok || payload?.success === false) {
        throw new Error(payload?.error || response.statusText || t('opencodeUpdate.toast.failed.description'));
      }

      toast.success(t('opencodeUpdate.toast.updated.title'), {
        id: UPGRADE_TOAST_ID,
        description: payload?.version
          ? t('opencodeUpdate.toast.updated.descriptionWithVersion', { version: payload.version })
          : t('opencodeUpdate.toast.updated.description'),
        duration: Infinity,
        icon: <Icon name="check" className="h-4 w-4 text-[var(--status-success)]" />,
        action: {
          label: t('opencodeUpdate.toast.actions.reload'),
          onClick: reloadOpenCode,
        },
      });
    } catch (error) {
      toast.error(t('opencodeUpdate.toast.failed.title'), {
        id: UPGRADE_TOAST_ID,
        description: error instanceof Error ? error.message : t('opencodeUpdate.toast.failed.description'),
        duration: Infinity,
      });
    } finally {
      upgradingRef.current = false;
    }
  }, [hideAvailableBanner, isPiKernel, reloadOpenCode, t]);

  React.useEffect(() => {
    const offerAvailableUpdate = (version: string) => {
      if (!useUIStore.getState().showOpenCodeUpdateNotifications) {
        hideAvailableBanner();
        return;
      }
      const decision = shouldShowOpenCodeUpdateToast({
        version,
        dismissedVersion: resolveDismissedOpenCodeUpdateVersion(
          getDeferredSafeStorage().getItem(UPDATE_TOAST_DISMISSED_VERSION_KEY),
        ),
        seenVersions: seenVersionsRef.current,
      });
      if (!decision) {
        return;
      }
      seenVersionsRef.current.add(version);
      setAvailableVersion(version);
      toast.dismiss(UPDATE_TOAST_ID);
    };

    let cancelled = false;
    const timeoutIds: Array<ReturnType<typeof setTimeout>> = [];

    const checkForUpdate = async (attempt: number, runtimeKey = getRuntimeKey()) => {
      if (isPiKernel) return;
      try {
        const response = await runtimeFetch('/api/opencode/upgrade-status', {
          headers: { Accept: 'application/json' },
        });
        if (!response.ok) throw new Error(response.statusText || 'Upgrade status check failed');
        const status = await response.json().catch(() => null) as OpenCodeUpgradeStatusLike | null;
        const version = resolveOpenCodeUpgradeStatusVersion(status);
        if (!cancelled && runtimeKey === getRuntimeKey() && version) {
          offerAvailableUpdate(version);
        }
      } catch {
        const delay = CHECK_RETRY_DELAYS_MS[attempt];
        if (!cancelled && runtimeKey === getRuntimeKey() && delay !== undefined) {
          timeoutIds.push(setTimeout(() => { void checkForUpdate(attempt + 1, runtimeKey); }, delay));
        }
      }
    };

    const onUpdateAvailable = (event: Event) => {
      const version = resolveOpenCodeUpdateVersion((event as CustomEvent<unknown>).detail);
      if (version) {
        void checkForUpdate(0);
      }
    };

    if (!isPiKernel && showOpenCodeUpdateNotifications) {
      timeoutIds.push(setTimeout(() => { void checkForUpdate(0); }, INITIAL_CHECK_DELAY_MS));
    }

    const unsubscribeRuntime = subscribeRuntimeEndpointChanged(({ runtimeKey }) => {
      seenVersionsRef.current.clear();
      hideAvailableBanner();
      if (!isPiKernel && useUIStore.getState().showOpenCodeUpdateNotifications) {
        void checkForUpdate(0, runtimeKey);
      }
    });

    window.addEventListener('openchamber:opencode-update-available', onUpdateAvailable);
    return () => {
      cancelled = true;
      for (const timeoutId of timeoutIds) clearTimeout(timeoutId);
      unsubscribeRuntime();
      window.removeEventListener('openchamber:opencode-update-available', onUpdateAvailable);
    };
  }, [hideAvailableBanner, isPiKernel, showOpenCodeUpdateNotifications]);

  if (isPiKernel || !availableVersion || !showOpenCodeUpdateNotifications) {
    return null;
  }

  return (
    <OpenCodeUpdateBanner
      title={t('opencodeUpdate.toast.available.title')}
      description={t('opencodeUpdate.toast.available.description', { version: availableVersion })}
      dismissLabel={t('opencodeUpdate.toast.actions.dismiss')}
      primaryLabel={t('opencodeUpdate.toast.actions.update')}
      onDismiss={() => dismissAvailableBanner(availableVersion)}
      onPrimary={() => {
        void runUpgrade();
      }}
    />
  );
};
