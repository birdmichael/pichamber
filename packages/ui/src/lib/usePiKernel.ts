import React from 'react';
import { runtimeFetch } from '@/lib/runtime-fetch';

/**
 * Session share, message revert, and composer / session.shell are OpenCode-only.
 * On Pi they are empty stubs and must not be offered as successful actions.
 */
export function canOfferOpenCodeSessionStub(isPiKernel: boolean): boolean {
  return !isPiKernel;
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
