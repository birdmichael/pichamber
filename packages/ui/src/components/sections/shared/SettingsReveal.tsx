import React from 'react';

import {
  nextSettingsRevealArmed,
  shouldConsumeSettingsRevealEvent,
  type SettingsRevealPointerPhase,
} from '@/lib/settings-reveal-guard';

function isKeyboardClick(event: Event): boolean {
  return event instanceof MouseEvent && event.type === 'click' && event.detail === 0;
}

function phaseFromEvent(event: Event): SettingsRevealPointerPhase | null {
  if (event.type === 'pointerdown' || event.type === 'pointerup' || event.type === 'click') {
    return event.type;
  }
  return null;
}

/**
 * Insert a Settings row without letting the leftover pointer hit it.
 * The first pointer-down/up/click on the new subtree is consumed; later gestures work.
 */
export const SettingsReveal: React.FC<{
  revealed: boolean;
  children: React.ReactNode;
  className?: string;
}> = ({ revealed, children, className }) => {
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  const [armed, setArmed] = React.useState(false);
  const wasRevealed = React.useRef(revealed);

  React.useLayoutEffect(() => {
    if (revealed && !wasRevealed.current) {
      setArmed(true);
    }
    if (!revealed) {
      setArmed(false);
    }
    wasRevealed.current = revealed;
  }, [revealed]);

  React.useLayoutEffect(() => {
    if (!armed) {
      return;
    }

    const handle = (event: Event) => {
      const phase = phaseFromEvent(event);
      if (!phase) {
        return;
      }
      const insideRevealed = Boolean(
        event.target instanceof Node && rootRef.current?.contains(event.target),
      );
      const keyboardClick = isKeyboardClick(event);
      if (shouldConsumeSettingsRevealEvent({ armed: true, insideRevealed, isKeyboardClick: keyboardClick })) {
        event.preventDefault();
        event.stopPropagation();
      }
      const stillArmed = nextSettingsRevealArmed({
        armed: true,
        phase,
        insideRevealed,
        isKeyboardClick: keyboardClick,
      });
      setArmed(stillArmed);
      if (stillArmed && phase === 'pointerup' && insideRevealed) {
        window.setTimeout(() => setArmed(false), 0);
      }
    };

    document.addEventListener('pointerdown', handle, true);
    document.addEventListener('pointerup', handle, true);
    document.addEventListener('click', handle, true);
    return () => {
      document.removeEventListener('pointerdown', handle, true);
      document.removeEventListener('pointerup', handle, true);
      document.removeEventListener('click', handle, true);
    };
  }, [armed]);

  if (!revealed) {
    return null;
  }

  return (
    <div ref={rootRef} className={className} data-settings-reveal={armed ? 'armed' : 'ready'}>
      {children}
    </div>
  );
};
