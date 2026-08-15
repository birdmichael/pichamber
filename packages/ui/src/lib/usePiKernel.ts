import React from 'react';
import { runtimeFetch } from '@/lib/runtime-fetch';

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
