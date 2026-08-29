// Chromium paints and timers stay at full rate only while a window is focused
// and visible. Packaged Desktop used to set backgroundThrottling: false on
// every BrowserWindow, so a hidden or unfocused window kept compositing.
// Restore the Chromium default (throttle) unless the window is in front.

const WINDOW_PAINT_EVENTS = ['focus', 'blur', 'show', 'hide', 'minimize', 'restore'];

const HIDDEN_TRAY_SNAPSHOT_INTERVAL_MS = 5000;

export const shouldPaintAtFullRate = ({ focused, visible } = {}) =>
  focused === true && visible === true;

export const resolveBackgroundThrottling = (state = {}) =>
  !shouldPaintAtFullRate(state);

export const isWindowPaintingAtFullRate = (browserWindow) => {
  if (!browserWindow || typeof browserWindow.isDestroyed === 'function' && browserWindow.isDestroyed()) {
    return false;
  }
  const focused = typeof browserWindow.isFocused === 'function' && browserWindow.isFocused();
  const visible = typeof browserWindow.isVisible === 'function' && browserWindow.isVisible()
    && !(typeof browserWindow.isMinimized === 'function' && browserWindow.isMinimized());
  return shouldPaintAtFullRate({ focused, visible });
};

export const applyWindowBackgroundThrottling = (browserWindow) => {
  if (!browserWindow || typeof browserWindow.isDestroyed === 'function' && browserWindow.isDestroyed()) {
    return true;
  }
  const throttling = resolveBackgroundThrottling({
    focused: typeof browserWindow.isFocused === 'function' && browserWindow.isFocused(),
    visible: typeof browserWindow.isVisible === 'function' && browserWindow.isVisible()
      && !(typeof browserWindow.isMinimized === 'function' && browserWindow.isMinimized()),
  });
  if (browserWindow.webContents) {
    browserWindow.webContents.backgroundThrottling = throttling;
  }
  return throttling;
};

export const bindWindowBackgroundThrottling = (browserWindow, { onChange } = {}) => {
  const apply = () => {
    const throttling = applyWindowBackgroundThrottling(browserWindow);
    if (typeof onChange === 'function') onChange({ throttling });
    return throttling;
  };

  apply();
  for (const event of WINDOW_PAINT_EVENTS) {
    browserWindow.on(event, apply);
  }
  return apply;
};

// When every window is throttled, keep the menu-bar counts from the last
// renderer snapshot. Re-applying that snapshot is cheap and does not keep a
// compositor-awake renderer just for the tray. Live busy/idle still arrives
// through desktop_tray_update when the renderer sees events.
export const createHiddenWindowTrayRepeater = ({
  getLastSnapshot,
  applySnapshot,
  isAnyWindowPainting,
  intervalMs = HIDDEN_TRAY_SNAPSHOT_INTERVAL_MS,
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
} = {}) => {
  let timer = null;

  const stop = () => {
    if (timer == null) return;
    clearIntervalFn(timer);
    timer = null;
  };

  const tick = () => {
    const snapshot = typeof getLastSnapshot === 'function' ? getLastSnapshot() : null;
    if (snapshot && typeof applySnapshot === 'function') applySnapshot(snapshot);
  };

  const start = () => {
    if (timer != null) return;
    timer = setIntervalFn(tick, intervalMs);
  };

  return {
    sync() {
      if (typeof isAnyWindowPainting === 'function' && isAnyWindowPainting()) {
        stop();
        return;
      }
      start();
    },
    dispose: stop,
    isRepeating: () => timer != null,
  };
};
