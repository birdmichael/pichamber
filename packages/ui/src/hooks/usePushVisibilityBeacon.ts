import React from 'react';
import { isDesktopShell, isWebRuntime } from '@/lib/desktop';
import { getClientPlatform, isCapacitorApp } from '@/lib/platform';
import { getRegisteredRuntimeAPIs } from '@/contexts/runtimeAPIRegistry';

export const HEARTBEAT_MS = 20000;

/** Electron lock/unlock is not a browser visibilitychange. Desktop must beacon. */
export const shouldReportPushVisibility = (input: {
  isWeb: boolean;
  isCapacitor: boolean;
  isDesktop: boolean;
}): boolean => input.isWeb || input.isCapacitor || input.isDesktop;

/** macOS lock/sleep is not a document blur. Latch hidden until unlock/resume. */
export const createSystemPresenceLatch = () => {
  let systemHidden = false;
  return {
    apply(visible: boolean | undefined): 'hidden' | 'report' {
      if (visible === false) {
        systemHidden = true;
        return 'hidden';
      }
      systemHidden = false;
      return 'report';
    },
    allowsVisibleHeartbeat(): boolean {
      return !systemHidden;
    },
  };
};

const resolveVisibilityState = (): 'visible' | 'hidden' => {
  if (typeof document === 'undefined') return 'visible';
  return document.visibilityState === 'visible' && document.hasFocus() ? 'visible' : 'hidden';
};

const sendVisibility = (visible: boolean) => {
  if (!shouldReportPushVisibility({
    isWeb: isWebRuntime(),
    isCapacitor: isCapacitorApp(),
    isDesktop: isDesktopShell(),
  })) {
    return;
  }

  const apis = getRegisteredRuntimeAPIs();
  if (!apis?.push?.setVisibility) {
    return;
  }

  // platform lets the server distinguish mobile (push recipients) from interactive surfaces
  // (desktop/web/vscode) so it can suppress phone push only while an interactive client is visible.
  void apis.push.setVisibility({ visible, platform: getClientPlatform() });
};

export const usePushVisibilityBeacon = (options?: { enabled?: boolean }) => {
  const enabled = options?.enabled ?? true;
  React.useEffect(() => {
    if (!enabled || typeof window === 'undefined') {
      return;
    }
    if (!shouldReportPushVisibility({
      isWeb: isWebRuntime(),
      isCapacitor: isCapacitorApp(),
      isDesktop: isDesktopShell(),
    })) {
      return;
    }

    // Native (Capacitor): drive visibility AUTHORITATIVELY from App.appStateChange. The
    // web signals (document.visibilityState / hasFocus) are unreliable in a WKWebView —
    // hasFocus() often returns false while the app is active — which made the app report
    // "hidden" while foregrounded and leaked push notifications. The server's focus gate
    // suppresses push whenever a UI client is visible, so getting this right is what
    // guarantees "no push while the app is active".
    if (isCapacitorApp()) {
      let active = true;
      let disposed = false;
      let removeListener: (() => void) | null = null;
      const reportActive = () => sendVisibility(active);

      void import('@capacitor/app')
        .then(async ({ App }) => {
          if (disposed) return;
          const state = await App.getState().catch(() => null);
          if (state) active = state.isActive === true;
          reportActive();
          const handle = await App.addListener('appStateChange', ({ isActive }) => {
            active = isActive === true;
            reportActive();
          });
          if (disposed) {
            void handle.remove();
            return;
          }
          removeListener = () => void handle.remove();
        })
        .catch(() => undefined);

      // Heartbeat so the server's visibility TTL never expires while the app is active.
      const interval = window.setInterval(() => {
        if (active) sendVisibility(true);
      }, HEARTBEAT_MS);

      return () => {
        disposed = true;
        window.clearInterval(interval);
        removeListener?.();
      };
    }

    // Web / desktop: document-based visibility.
    if (typeof document === 'undefined') {
      return;
    }

    const presenceLatch = createSystemPresenceLatch();

    const report = () => {
      if (!presenceLatch.allowsVisibleHeartbeat()) {
        sendVisibility(false);
        return;
      }
      sendVisibility(resolveVisibilityState() === 'visible');
    };

    const reportVisibleOnly = () => {
      if (!presenceLatch.allowsVisibleHeartbeat()) return;
      if (resolveVisibilityState() === 'visible') {
        sendVisibility(true);
      }
    };

    const reportPageHidden = () => {
      sendVisibility(false);
    };

    report();

    const interval = window.setInterval(reportVisibleOnly, HEARTBEAT_MS);

    const onSystemPresence = (event: Event) => {
      const detail = (event as CustomEvent<{ visible?: boolean }>).detail;
      if (presenceLatch.apply(detail?.visible) === 'hidden') {
        sendVisibility(false);
        return;
      }
      report();
    };

    document.addEventListener('visibilitychange', report);
    window.addEventListener('pagehide', reportPageHidden);
    window.addEventListener('pageshow', report);
    window.addEventListener('focus', report);
    window.addEventListener('blur', report);
    window.addEventListener('openchamber:system-presence', onSystemPresence);

    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', report);
      window.removeEventListener('pagehide', reportPageHidden);
      window.removeEventListener('pageshow', report);
      window.removeEventListener('focus', report);
      window.removeEventListener('blur', report);
      window.removeEventListener('openchamber:system-presence', onSystemPresence);
    };
  }, [enabled]);
};
