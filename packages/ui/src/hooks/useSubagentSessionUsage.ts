import React from 'react';

import { runBackgroundNetworkTask } from '@/lib/background-network';
import { runtimeFetch } from '@/lib/runtime-fetch';
import type { WorkStatusSubagentUsage } from '@/lib/subagents/workStatusRows';

type UsageMap = Record<string, WorkStatusSubagentUsage | null>;

type SessionTarget = {
  sessionID: string;
  directory?: string | null;
};

const readUsage = (value: unknown): WorkStatusSubagentUsage | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as { available?: unknown; sessionTokens?: unknown; cost?: unknown };
  if (record.available === false) return null;
  const tokens = typeof record.sessionTokens === 'number'
    && Number.isFinite(record.sessionTokens)
    && record.sessionTokens >= 0
    ? record.sessionTokens
    : null;
  const cost = typeof record.cost === 'number'
    && Number.isFinite(record.cost)
    && record.cost >= 0
    ? record.cost
    : null;
  if (tokens === null && cost === null) return null;
  return {
    ...(tokens !== null ? { tokens } : {}),
    ...(cost !== null ? { cost } : {}),
  };
};

export const subagentUsageKey = (targets: readonly SessionTarget[]): string => (
  targets.map((target) => `${target.sessionID}:${target.directory ?? ''}`).sort().join('|')
);

/** Poll cumulative child-session usage without coupling Work Status to a chat tab. */
export const useSubagentSessionUsage = (
  targets: readonly SessionTarget[],
  enabled: boolean,
): UsageMap => {
  const [usageBySession, setUsageBySession] = React.useState<UsageMap>({});
  const key = React.useMemo(() => subagentUsageKey(targets), [targets]);

  React.useEffect(() => {
    if (!enabled || targets.length === 0) {
      setUsageBySession({});
      return undefined;
    }

    let cancelled = false;
    const load = () => {
      void runBackgroundNetworkTask(async () => {
        const results = await Promise.all(targets.map(async (target) => {
          try {
            const response = await runtimeFetch(`/api/session/${encodeURIComponent(target.sessionID)}/usage`, {
              headers: { Accept: 'application/json' },
            });
            if (!response.ok) return [target.sessionID, null] as const;
            return [target.sessionID, readUsage(await response.json().catch(() => null))] as const;
          } catch {
            return [target.sessionID, null] as const;
          }
        }));
        if (cancelled) return;
        setUsageBySession(Object.fromEntries(results));
      });
    };

    void key;
    load();
    const timer = window.setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      load();
    }, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [enabled, key, targets]);

  return usageBySession;
};
