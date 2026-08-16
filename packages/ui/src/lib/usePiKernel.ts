import React from 'react';
import { runtimeFetch } from '@/lib/runtime-fetch';

/**
 * Session share, message revert, and composer / session.shell are OpenCode-only.
 * On Pi they are empty stubs and must not be offered as successful actions.
 */
export function canOfferOpenCodeSessionStub(isPiKernel: boolean): boolean {
  return !isPiKernel;
}

/**
 * Session Goal is a Pichamber product feature, not an OpenCode leftover.
 * `isPiKernel` must not hide the composer target button, objective counter,
 * or Settings Chat sessionGoal group. VS Code still hides the entry point
 * because the loop runs in the web server.
 */
export function isSessionGoalVisibleOnPiKernel(isPiKernel: boolean): boolean {
  void isPiKernel;
  return true;
}

export function usePiKernel(): boolean {
  const [isPiKernel, setIsPiKernel] = React.useState(true);
  React.useEffect(() => {
    let cancelled = false;
    void runtimeFetch('/api/health', { method: 'GET' })
      .then((res) => res.ok ? res.json() : null)
      .then((payload) => {
        if (!cancelled && payload && typeof payload.kernel === 'string') {
          setIsPiKernel(payload.kernel === 'pi');
        }
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, []);
  return isPiKernel;
}
