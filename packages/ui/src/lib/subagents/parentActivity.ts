import type { SubagentRun, SubagentRunState } from './subagentRuns';
import type { WorkStatusSubagentRow } from './workStatusRows';

const ACTIVE_RUN_STATES = new Set<SubagentRunState>(['queued', 'running', 'blocked', 'paused']);
const ACTIVE_ROW_STATUSES = new Set<WorkStatusSubagentRow['status']>([
  'working',
  'queued',
  'blocked',
  'paused',
  'permission',
  'question',
]);

/** Fleet rows that mean the parent task is still in progress (Codex-aligned). */
export const isActiveSubagentRunState = (state: SubagentRunState | null | undefined): boolean => (
  Boolean(state && ACTIVE_RUN_STATES.has(state))
);

export const hasActiveSubagentFleet = (
  runs: ReadonlyArray<Pick<SubagentRun, 'state'>> | null | undefined,
): boolean => (Array.isArray(runs) ? runs.some((run) => isActiveSubagentRunState(run.state)) : false);

export const hasActiveWorkStatusSubagentRows = (
  rows: ReadonlyArray<Pick<WorkStatusSubagentRow, 'status'>> | null | undefined,
): boolean => (Array.isArray(rows) ? rows.some((row) => ACTIVE_ROW_STATUSES.has(row.status)) : false);

export const openCodeChildBusy = (
  children: ReadonlyArray<{ id: string; parentID?: string | null }>,
  parentSessionId: string | null | undefined,
  statuses: Readonly<Record<string, { type?: string } | undefined>>,
): boolean => {
  const parent = parentSessionId?.trim() || '';
  if (!parent) return false;
  return children.some((child) => {
    if (child.parentID !== parent) return false;
    const type = statuses[child.id]?.type;
    return type === 'busy' || type === 'retry';
  });
};

/**
 * Context-tab / open label: child remains a deep-dive of the parent, not a
 * peer chat window. Parent title is optional when the live session is unknown.
 */
export const formatSubagentOwnedLabel = (
  childLabel: string,
  parentLabel?: string | null,
): string => {
  const child = childLabel.trim() || 'Subagent';
  const parent = parentLabel?.trim() || '';
  if (!parent) return child;
  return `${child} · ${parent}`;
};

export const subagentHandoffKey = (parentSessionId: string, runId: string): string => (
  `${parentSessionId.trim()}:${runId.trim()}`
);

/** Background success is the normal auto path; failed/stopped stay manual. */
export const shouldAutoHandoffSubagent = (
  row: Pick<WorkStatusSubagentRow, 'mode' | 'status' | 'sessionID'>,
): boolean => (
  row.mode === 'background'
  && row.status === 'done'
  && Boolean(row.sessionID?.trim())
);

export const buildSubagentHandoffMessage = (
  label: string,
  summary: string,
  template: { withBody: string; empty: string },
): string => {
  const name = label.trim() || 'Subagent';
  const body = summary.trim();
  if (!body) return template.empty.replaceAll('{name}', name);
  return template.withBody.replaceAll('{name}', name).replaceAll('{body}', body);
};

const postedHandoffs = new Set<string>();

export const wasSubagentHandoffPosted = (key: string): boolean => postedHandoffs.has(key);

export const markSubagentHandoffPosted = (key: string): void => {
  const normalized = key.trim();
  if (normalized) postedHandoffs.add(normalized);
};

/** Test-only: clear the in-memory auto-handoff ledger. */
export const resetSubagentHandoffLedgerForTests = (): void => {
  postedHandoffs.clear();
};
