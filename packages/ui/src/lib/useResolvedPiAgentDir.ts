import * as React from 'react';
import { runtimeFetch } from '@/lib/runtime-fetch';
import { subscribeRuntimeEndpointChanged } from '@/lib/runtime-switch';

const DEFAULT_PI_AGENT_DIR = '~/.pi/agent';

export function useResolvedPiAgentDir(): string {
  const [agentDir, setAgentDir] = React.useState(DEFAULT_PI_AGENT_DIR);

  React.useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const response = await runtimeFetch('/api/path', {
          method: 'GET',
          headers: { Accept: 'application/json' },
        });
        if (!response.ok) return;
        const data = await response.json().catch(() => null) as { config?: unknown } | null;
        const config = typeof data?.config === 'string' ? data.config.trim() : '';
        if (!cancelled && config) {
          setAgentDir(config);
        }
      } catch {
        // Keep the default name until an authoritative path arrives.
      }
    };

    void load();
    const unsubscribe = subscribeRuntimeEndpointChanged(() => {
      if (!cancelled) void load();
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  return agentDir;
}
