import React from 'react';

import { runBackgroundNetworkTask } from '@/lib/background-network';
import { runtimeFetch } from '@/lib/runtime-fetch';
import { parseSubagentRunsPayload, type SubagentRun } from '@/lib/subagents/subagentRuns';

const SUBAGENT_RUNS_REQUEST_TIMEOUT_MS = 5_000;

type LoadState = {
  sessionId: string | null;
  status: 'idle' | 'loading' | 'ready' | 'error';
  runs: SubagentRun[];
};

export const visibleSubagentRuns = (
  state: LoadState,
  sessionId: string | null,
  enabled: boolean,
): { runs: SubagentRun[]; status: LoadState['status'] } => {
  if (!enabled || !sessionId) {
    return { runs: [], status: 'idle' };
  }
  if (state.sessionId !== sessionId) {
    return { runs: [], status: 'loading' };
  }
  return { runs: state.runs, status: state.status };
};

export const subagentRunsRequestHeaders = (directory?: string | null): Record<string, string> => ({
  Accept: 'application/json',
  ...(directory?.trim() ? { 'x-opencode-directory': directory.trim() } : {}),
});

export const useSubagentRuns = (
  sessionId: string | null,
  enabled: boolean,
  directory?: string | null,
): { runs: SubagentRun[]; status: LoadState['status'] } => {
  const [state, setState] = React.useState<LoadState>({ sessionId: null, status: 'idle', runs: [] });

  React.useEffect(() => {
    if (!enabled || !sessionId) {
      setState({ sessionId: sessionId ?? null, status: 'idle', runs: [] });
      return undefined;
    }

    let cancelled = false;
    let inFlight = false;
    const load = () => {
      if (inFlight) return;
      inFlight = true;
      void runBackgroundNetworkTask(async () => {
        const controller = new AbortController();
        const timeout = window.setTimeout(() => controller.abort(), SUBAGENT_RUNS_REQUEST_TIMEOUT_MS);
        try {
          const response = await runtimeFetch(`/api/session/${encodeURIComponent(sessionId)}/subagent-runs`, {
            headers: subagentRunsRequestHeaders(directory),
            signal: controller.signal,
          });
          const parsed = parseSubagentRunsPayload(await response.json().catch(() => null));
          if (cancelled) return;
          if (!response.ok || !parsed) {
            setState((current) => {
              if (current.sessionId !== sessionId) return current;
              return current.status === 'ready'
                ? current
                : { sessionId, status: 'error', runs: current.runs };
            });
            return;
          }
          setState({ sessionId, status: 'ready', runs: parsed });
        } catch {
          if (cancelled) return;
          setState((current) => {
            if (current.sessionId !== sessionId) return current;
            return current.status === 'ready'
              ? current
              : { sessionId, status: 'error', runs: current.runs };
          });
        } finally {
          window.clearTimeout(timeout);
          inFlight = false;
        }
      });
    };

    setState((current) => (
      current.sessionId === sessionId
        ? (current.status === 'ready' ? current : { sessionId, status: 'loading', runs: current.runs })
        : { sessionId, status: 'loading', runs: [] }
    ));
    void load();
    const timer = window.setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      void load();
    }, 2000);
    const onVisibility = () => {
      if (typeof document === 'undefined' || document.hidden) return;
      void load();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [directory, enabled, sessionId]);

  return visibleSubagentRuns(state, sessionId, enabled);
};
