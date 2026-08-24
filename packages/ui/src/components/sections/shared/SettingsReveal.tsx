import React from 'react';

import { SETTINGS_REVEAL_GUARD_MS } from '@/lib/settings-reveal-guard';

/**
 * Insert a Settings row without letting the leftover click hit it.
 * The new content stays visible but ignores pointer events for a beat.
 */
export const SettingsReveal: React.FC<{
  revealed: boolean;
  children: React.ReactNode;
  className?: string;
}> = ({ revealed, children, className }) => {
  const [ignorePointer, setIgnorePointer] = React.useState(false);
  const wasRevealed = React.useRef(revealed);

  React.useEffect(() => {
    if (revealed && !wasRevealed.current) {
      setIgnorePointer(true);
      const timeout = window.setTimeout(() => setIgnorePointer(false), SETTINGS_REVEAL_GUARD_MS);
      wasRevealed.current = revealed;
      return () => window.clearTimeout(timeout);
    }
    if (!revealed) {
      setIgnorePointer(false);
    }
    wasRevealed.current = revealed;
  }, [revealed]);

  if (!revealed) {
    return null;
  }

  return (
    <div className={className} style={ignorePointer ? { pointerEvents: 'none' } : undefined}>
      {children}
    </div>
  );
};
