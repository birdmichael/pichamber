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
import {
  dismissOpenCodeUpdateToast,
  resolveDismissedOpenCodeUpdateVersion,
  resolveOpenCodeUpdateVersion,
  resolveOpenCodeUpgradeStatusVersion,
  resolvePiUpgradeStatusVersion,
  shouldShowOpenCodeUpdateToast,
  type OpenCodeUpgradeStatusLike,
} from './openCodeUpdateDedup';

const UPDATE_TOAST_ID = 'opencode-update-available';
const UPGRADE_TOAST_ID = 'opencode-upgrade-progress';
const INITIAL_CHECK_DELAY_MS = 5_000;
const CHECK_RETRY_DELAYS_MS = [10_000, 60_000];
const UPDATE_TOAST_DISMISSED_VERSION_KEY = 'opencode-update-toast-dismissed-version';

export const OpenCodeUpdateToast: React.FC = () => {
  const { t } = useI18n();
  const tRef = React.useRef(t);
  tRef.current = t;
  const isPiKernel = usePiKernel();
  const showOpenCodeUpdateNotifications = useUIStore((state) => state.showOpenCodeUpdateNotifications);
  const seenVersionsRef = React.useRef(new Set<string>());
  const upgradingRef = React.useRef(false);

  React.useEffect(() => {
    if (!showOpenCodeUpdateNotifications) {
      toast.dismiss(UPDATE_TOAST_ID);
    }
  }, [showOpenCodeUpdateNotifications]);

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
    toast.dismiss(UPDATE_TOAST_ID);
    toast.message(tRef.current('opencodeUpdate.toast.upgrading.title'), {
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
  }, [isPiKernel, reloadOpenCode, t]);

  React.useEffect(() => {
    const showUpdateAvailableToast = (version: string) => {
      // Upstream setting wins over our dedup logic: if user disabled
      // OpenCode update notifications, dismiss any active toast and bail
      // before consulting dedup state.
      if (!useUIStore.getState().showOpenCodeUpdateNotifications) {
        toast.dismiss(UPDATE_TOAST_ID);
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

      const persistDismissedVersion = (dismissedVersion: string) => {
        getDeferredSafeStorage().setItem(UPDATE_TOAST_DISMISSED_VERSION_KEY, dismissedVersion);
        void updateDesktopSettings({ openCodeUpdateToastDismissedVersion: dismissedVersion });
      };

      let hidingToast = false;
      const dismiss = () => {
        dismissOpenCodeUpdateToast({
          version,
          persistDismissedVersion,
          hideToast: () => {
            if (hidingToast) return;
            hidingToast = true;
            toast.dismiss(UPDATE_TOAST_ID);
          },
        });
      };

      if (isPiKernel) {
        // Pass action so toast.info does not inject a no-op OK. Both
        // buttons hide the toast; Linux Electron also needs no-drag on
        // the toaster or the header drag region swallows the click.
        toast.info(tRef.current('piUpdate.toast.available.title', { version }), {
          id: UPDATE_TOAST_ID,
          duration: Infinity,
          onDismiss: dismiss,
          action: {
            label: tRef.current('piUpdate.toast.actions.ok'),
            onClick: dismiss,
          },
          cancel: {
            label: tRef.current('piUpdate.toast.actions.dismiss'),
            onClick: dismiss,
          },
        });
        return;
      }

      toast.info(tRef.current('opencodeUpdate.toast.available.title'), {
        id: UPDATE_TOAST_ID,
        description: tRef.current('opencodeUpdate.toast.available.description', { version }),
        duration: Infinity,
        onDismiss: dismiss,
        action: {
          label: tRef.current('opencodeUpdate.toast.actions.update'),
          onClick: runUpgrade,
        },
        cancel: {
          label: tRef.current('opencodeUpdate.toast.actions.dismiss'),
          onClick: dismiss,
        },
      });
    };

    let cancelled = false;
    const timeoutIds: Array<ReturnType<typeof setTimeout>> = [];

    const checkForUpdate = async (attempt: number, runtimeKey = getRuntimeKey()) => {
      try {
        const path = isPiKernel ? '/api/pi/upgrade-status' : '/api/opencode/upgrade-status';
        const response = await runtimeFetch(path, { headers: { Accept: 'application/json' } });
        if (!response.ok) throw new Error(response.statusText || 'Upgrade status check failed');
        const status = await response.json().catch(() => null) as OpenCodeUpgradeStatusLike | null;
        const version = isPiKernel
          ? resolvePiUpgradeStatusVersion(status)
          : resolveOpenCodeUpgradeStatusVersion(status);
        if (!cancelled && runtimeKey === getRuntimeKey() && version) {
          showUpdateAvailableToast(version);
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

    if (showOpenCodeUpdateNotifications) {
      timeoutIds.push(setTimeout(() => { void checkForUpdate(0); }, INITIAL_CHECK_DELAY_MS));
    }

    const unsubscribeRuntime = subscribeRuntimeEndpointChanged(({ runtimeKey }) => {
      seenVersionsRef.current.clear();
      toast.dismiss(UPDATE_TOAST_ID);
      if (useUIStore.getState().showOpenCodeUpdateNotifications) {
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
  }, [isPiKernel, runUpgrade, showOpenCodeUpdateNotifications]);

  return null;
};
