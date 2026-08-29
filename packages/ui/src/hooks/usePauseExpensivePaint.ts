import React from 'react';

// Hidden windows do not need live backdrop-filter. Keep frosting while the
// document is visible so a focused overlay still looks the same.

export const EXPENSIVE_PAINT_PAUSE_CLASS = 'oc-pause-expensive-paint';

export const shouldPauseExpensivePaint = (input: { visible: boolean }): boolean => (
  input.visible !== true
);

export const applyExpensivePaintPause = (
  root: { classList: { toggle: (className: string, force: boolean) => void } },
  pause: boolean,
): void => {
  root.classList.toggle(EXPENSIVE_PAINT_PAUSE_CLASS, pause);
};

export const usePauseExpensivePaint = (): void => {
  React.useEffect(() => {
    if (typeof document === 'undefined') return;

    const sync = () => {
      applyExpensivePaintPause(
        document.documentElement,
        shouldPauseExpensivePaint({ visible: document.visibilityState === 'visible' }),
      );
    };

    sync();
    document.addEventListener('visibilitychange', sync);
    return () => {
      document.removeEventListener('visibilitychange', sync);
      applyExpensivePaintPause(document.documentElement, false);
    };
  }, []);
};
