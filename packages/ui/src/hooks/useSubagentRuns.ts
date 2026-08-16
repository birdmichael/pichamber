import React from 'react';

import { runBackgroundNetworkTask } from '@/lib/background-network';
import { runtimeFetch } from '@/lib/runtime-fetch';
import { parseSubagentRunsPayload, type SubagentRun } from '@/lib/subagents/subagentRuns';

type LoadState =
  | { status: 'idle' | 'loading'; runs: SubagentRun[] }
  | { status: 'ready'; runs: SubagentRun[] }
  | { status: 'error'; runs: SubagentRun[] };

export const useSubagentRuns = (
  sessionId: string | null,
  enabled: boolean,
): { runs: SubagentRun[]; status: LoadState['status'] } => {
  const [state, setState] = React.useState<LoadState>({ status: 'idle', runs: [] });

  React.useEffect(() => {
    if (!enabled || !sessionId) {
      setState({ status: 'idle', runs: [] });
      return undefined;
    }

    let cancelled = false;
    const load = () => runBackgroundNetworkTask(async () => {
      try {
        const response = await runtimeFetch(`/api/session/${encodeURIComponent(sessionId)}/subagent-runs`, {
          headers: { Accept: 'application/json' },
        });
        const parsed = parseSubagentRunsPayload(await response.json().catch(() => null));
        if (cancelled) return;
        if (!response.ok || !parsed) {
          setState((current) => (
            current.status === 'ready' ? current : { status: 'error', runs: current.runs }
          ));
          return;
        }
        setState({ status: 'ready', runs: parsed });
      } catch {
        if (cancelled) return;
        setState((current) => (
          current.status === 'ready' ? current : { status: 'error', runs: current.runs }
        ));
      }
    });

    setState((current) => (
      current.status === 'ready' ? current : { status: 'loading', runs: current.runs }
    ));
    void load();
    const timer = window.setInterval(() => {
      void load();
    }, 2000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [enabled, sessionId]);

  return { runs: state.runs, status: state.status };
};
