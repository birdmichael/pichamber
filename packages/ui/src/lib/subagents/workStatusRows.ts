import { readTaskSessionIdFromOutput, readTaskSessionIdFromRecord } from '@/components/chat/message/parts/taskToolModel';

import { canOpenSubagentChildSession, resolveSubagentChildDirectory } from './childSession';
import { readSubagentChildSessionId } from './subagentTool';
import type { SubagentRun } from './subagentRuns';
import { formatProviderModelLabel } from '@/lib/modelDisplay';

export type WorkStatusSubagentUsage = {
  /** Cumulative billed tokens, not the current context-window snapshot. */
  tokens?: number | null;
  /** Cumulative USD spend. Pichamber always renders this with `$`. */
  cost?: number | null;
};

export type WorkStatusSubagentRow = {
  id: string;
  label: string;
  sessionID: string | null;
  directory: string | null;
  openable: boolean;
  providerId?: string;
  modelId?: string;
  status: 'permission' | 'question' | 'working' | 'queued' | 'blocked' | 'failed' | 'paused' | 'stopped' | 'done';
  mode?: 'foreground' | 'background';
  usage?: WorkStatusSubagentUsage | null;
};

export type WorkStatusSubagentTreeNode = {
  id: string;
  row: WorkStatusSubagentRow | null;
  children: WorkStatusSubagentTreeNode[];
};

/**
 * Build the fan-out rooted at the currently displayed session. The status API
 * normally returns direct children only, but parentByRowId also lets the UI
 * preserve deeper relationships when an adapter supplies them.
 *
 * Unknown or missing parent ids intentionally attach to the root. That keeps
 * the tree useful during the short window where a child session has been
 * created but its relationship metadata has not arrived yet.
 */
export const buildWorkStatusSubagentTree = ({
  rows,
  rootId,
  parentByRowId,
}: {
  rows: WorkStatusSubagentRow[];
  rootId?: string | null;
  parentByRowId?: Readonly<Record<string, string | null | undefined>>;
}): WorkStatusSubagentTreeNode | null => {
  const normalizedRootId = rootId?.trim() || '';
  if (!normalizedRootId || rows.length === 0) return null;

  const nodes = rows.map((row) => ({
    id: row.sessionID?.trim() || row.id,
    row,
    children: [] as WorkStatusSubagentTreeNode[],
  }));
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const root: WorkStatusSubagentTreeNode = { id: normalizedRootId, row: null, children: [] };
  const parentIds = new Map(nodes.map((node) => {
    const requested = parentByRowId?.[node.row.id]?.trim() || normalizedRootId;
    return [node.id, byId.has(requested) ? requested : normalizedRootId] as const;
  }));

  for (const node of nodes) {
    const directParentId = parentIds.get(node.id) || normalizedRootId;
    let cursor = node.id;
    const seen = new Set<string>();
    let cycle = false;
    while (cursor !== normalizedRootId) {
      if (seen.has(cursor)) {
        cycle = true;
        break;
      }
      seen.add(cursor);
      cursor = parentIds.get(cursor) || normalizedRootId;
    }
    // A malformed adapter payload must not make a row disappear or create a
    // self-referential tree. It is safest to keep that row visible at root.
    const parentId = cycle ? normalizedRootId : directParentId;
    (parentId === normalizedRootId ? root : byId.get(parentId) || root).children.push(node);
  }

  return root;
};

export const resolveWorkStatusSubagentOpen = ({
  sessionID,
  directory,
  effectiveDirectory,
}: {
  sessionID?: string | null;
  directory?: string | null;
  effectiveDirectory?: string | null;
}): { sessionID: string | null; directory: string | null; openable: boolean } => {
  const resolvedSessionID = sessionID?.trim() || null;
  const resolvedDirectory = resolveSubagentChildDirectory(directory, effectiveDirectory);
  return {
    sessionID: resolvedSessionID,
    directory: resolvedDirectory,
    openable: canOpenSubagentChildSession(resolvedSessionID, resolvedDirectory),
  };
};

export const collectSessionBlockers = (
  states: Array<{
    permission?: Record<string, unknown[] | undefined>;
    question?: Record<string, unknown[] | undefined>;
  }>,
): { permissions: Record<string, unknown[]>; questions: Record<string, unknown[]> } => {
  const permissions: Record<string, unknown[]> = {};
  const questions: Record<string, unknown[]> = {};
  for (const state of states) {
    for (const [id, list] of Object.entries(state.permission ?? {})) {
      if (Array.isArray(list) && list.length > 0) permissions[id] = list;
    }
    for (const [id, list] of Object.entries(state.question ?? {})) {
      if (Array.isArray(list) && list.length > 0) questions[id] = list;
    }
  }
  return { permissions, questions };
};

export const overlayWorkStatusChildBlockers = (
  rows: WorkStatusSubagentRow[],
  blockers: { permissions: Record<string, unknown[]>; questions: Record<string, unknown[]> },
): WorkStatusSubagentRow[] => rows.map((row) => {
  if (!row.sessionID) return row;
  if ((blockers.permissions[row.sessionID]?.length ?? 0) > 0) {
    return { ...row, status: 'permission' as const };
  }
  if ((blockers.questions[row.sessionID]?.length ?? 0) > 0) {
    return { ...row, status: 'question' as const };
  }
  return row;
});

const asTrimmed = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const readTranscriptSubagentSessionId = (part: {
  metadata?: unknown;
  state?: { metadata?: unknown; input?: unknown; output?: unknown };
  input?: unknown;
  output?: unknown;
}): string | null => {
  const state = part.state && typeof part.state === 'object' ? part.state : {};
  const input = (state.input && typeof state.input === 'object' ? state.input : part.input) as Record<string, unknown> | undefined;
  const output = state.output ?? part.output;
  const outputText = typeof output === 'string' ? output : undefined;
  return readTaskSessionIdFromRecord(state.metadata)
    ?? readTaskSessionIdFromRecord(part.metadata)
    ?? readTaskSessionIdFromOutput(outputText)
    ?? readSubagentChildSessionId(input, output);
};

export const collectTranscriptSubagentSessionIds = (
  messages: Array<{ parts?: unknown[] }> | null | undefined,
): Array<{ runId: string; sessionID: string }> => {
  const collected: Array<{ runId: string; sessionID: string }> = [];
  const seen = new Set<string>();
  for (const entry of Array.isArray(messages) ? messages : []) {
    for (const part of Array.isArray(entry?.parts) ? entry.parts : []) {
      if (!part || typeof part !== 'object') continue;
      const record = part as {
        tool?: unknown;
        callID?: unknown;
        id?: unknown;
        metadata?: unknown;
        state?: { metadata?: unknown; input?: unknown; output?: unknown };
        input?: unknown;
        output?: unknown;
      };
      if (asTrimmed(record.tool).toLowerCase() !== 'subagent') continue;
      const sessionID = readTranscriptSubagentSessionId(record);
      if (!sessionID) continue;
      const runId = asTrimmed(record.callID) || asTrimmed(record.id);
      const key = `${runId}:${sessionID}`;
      if (!runId || seen.has(key)) continue;
      seen.add(key);
      collected.push({ runId, sessionID });
    }
  }
  return collected;
};

export const assignTranscriptSessionIds = (
  runs: SubagentRun[],
  transcriptIds: Array<{ runId: string; sessionID: string }>,
): SubagentRun[] => {
  const byRunId = new Map(transcriptIds.map((item) => [item.runId, item.sessionID]));
  const used = new Set<string>();
  const assigned = runs.map((run) => {
    const matched = run.sessionID
      || byRunId.get(run.runId)
      || (run.toolCallId ? byRunId.get(run.toolCallId) : null)
      || null;
    if (matched) used.add(matched);
    if (matched === run.sessionID) return run;
    return {
      ...run,
      sessionID: matched,
      openable: Boolean(matched),
    };
  });
  const unused = transcriptIds.filter((item) => !used.has(item.sessionID));
  let nextUnused = 0;
  return assigned.map((run) => {
    if (run.sessionID || nextUnused >= unused.length) return run;
    const fallback = unused[nextUnused];
    nextUnused += 1;
    return {
      ...run,
      sessionID: fallback.sessionID,
      openable: true,
    };
  });
};

export const buildWorkStatusSubagentRows = ({
  runs,
  transcriptIds,
  directory,
  effectiveDirectory,
  untitledLabel,
}: {
  runs: SubagentRun[];
  transcriptIds: Array<{ runId: string; sessionID: string }>;
  directory?: string | null;
  effectiveDirectory?: string | null;
  untitledLabel: string;
}): WorkStatusSubagentRow[] => {
  const rows = assignTranscriptSessionIds(runs, transcriptIds).map((run) => {
    const opened = resolveWorkStatusSubagentOpen({
      sessionID: run.sessionID,
      directory: run.directory,
      effectiveDirectory: directory || effectiveDirectory,
    });
    const status = run.blocker === 'permission'
      ? 'permission'
      : run.blocker === 'question'
        ? 'question'
        : mapSubagentRunStateToRowStatus(run.state);
    return {
      id: run.runId,
      label: run.title?.trim() || run.name || untitledLabel,
      sessionID: opened.sessionID,
      directory: opened.directory,
      openable: opened.openable,
      ...(run.providerId || run.modelId ? {
        ...(run.providerId ? { providerId: run.providerId } : {}),
        ...(run.modelId ? { modelId: run.modelId } : {}),
      } : {}),
      mode: run.mode,
      status,
    };
  });
  return rows.filter((row) => (
    row.openable
    || row.status === 'working'
    || row.status === 'queued'
    || row.status === 'blocked'
    || row.status === 'paused'
    || row.status === 'permission'
    || row.status === 'question'
  ));
};

export const mapSubagentRunStateToRowStatus = (
  state: SubagentRun['state'],
): WorkStatusSubagentRow['status'] => {
  if (state === 'queued') return 'queued';
  if (state === 'running') return 'working';
  if (state === 'blocked') return 'blocked';
  if (state === 'paused') return 'paused';
  if (state === 'failed') return 'failed';
  if (state === 'stopped') return 'stopped';
  return 'done';
};

export const overlayWorkStatusSubagentRow = (
  row: WorkStatusSubagentRow,
  overlays: { permission?: boolean; question?: boolean; uiPrompt?: boolean },
): WorkStatusSubagentRow => {
  if (overlays.permission) return { ...row, status: 'permission' };
  if (overlays.question || overlays.uiPrompt) return { ...row, status: 'question' };
  return row;
};


export const formatWorkStatusSubagentModelLabel = ({
  providerId,
  modelId,
  providerName,
  modelName,
}: {
  providerId?: string | null;
  modelId?: string | null;
  providerName?: string | null;
  modelName?: string | null;
}): string => formatProviderModelLabel({ providerId, modelId, providerName, modelName })
  || modelName?.trim()
  || modelId?.trim()
  || providerName?.trim()
  || providerId?.trim()
  || '';

export const resolveWorkStatusSubagentLabel = (
  run: Pick<SubagentRun, 'title' | 'name'>,
  liveTitle: string | null | undefined,
  untitledLabel: string,
): string => {
  const sessionTitle = liveTitle?.trim() || '';
  if (sessionTitle) return sessionTitle;
  const runTitle = run.title?.trim() || '';
  if (runTitle) return runTitle;
  return run.name?.trim() || untitledLabel;
};

const asTranscriptRecord = (value: unknown): Record<string, unknown> => (
  value && typeof value === 'object' ? value as Record<string, unknown> : {}
);

const readTranscriptText = (value: unknown): string => {
  const record = asTranscriptRecord(value);
  if (record.type === 'text' && typeof record.text === 'string') return record.text;
  if (typeof record.text === 'string') return record.text;
  return '';
};

/** Keep parent handoff sends pinned to the parent even when the Work Status panel
 * is rendered from an embedded/child chat whose current-session state differs. */
export const buildSubagentParentSendOptions = (
  parentSessionId: string,
  parentDirectory: string | null | undefined,
): { sessionId: string; directory?: string } => ({
  sessionId: parentSessionId,
  ...(parentDirectory ? { directory: parentDirectory } : {}),
});

/** Pick the latest useful assistant text for the Work Status parent handoff. */
export const summarizeSubagentTranscript = (
  messages: Array<{ info?: { role?: unknown }; parts?: unknown[] }> | null | undefined,
  maxLength = 600,
): string => {
  const candidates = (Array.isArray(messages) ? messages : [])
    .slice()
    .reverse()
    .flatMap((message) => {
      const text = (Array.isArray(message.parts) ? message.parts : []).map(readTranscriptText).join(' ').replace(/\s+/g, ' ').trim();
      return text && message.info?.role === 'assistant' ? [text] : [];
    });
  const fallback = (Array.isArray(messages) ? messages : [])
    .slice()
    .reverse()
    .flatMap((message) => {
      const text = (Array.isArray(message.parts) ? message.parts : []).map(readTranscriptText).join(' ').replace(/\s+/g, ' ').trim();
      return text ? [text] : [];
    });
  const text = candidates[0] || fallback[0] || '';
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(1, maxLength - 1)).trimEnd()}…`;
};

export const countExportableWorkStatusRows = (rows: WorkStatusSubagentRow[]): number => (
  rows.filter((row) => row.openable).length
);

export type WorkStatusSubagentSummary = {
  queuedUnopenable: number;
  openable: number;
  busy: number;
  total: number;
};

export const summarizeWorkStatusSubagentRows = (rows: WorkStatusSubagentRow[]): WorkStatusSubagentSummary => ({
  queuedUnopenable: rows.filter((row) => !row.openable && row.status === 'queued').length,
  openable: countExportableWorkStatusRows(rows),
  busy: rows.filter((row) => (
    row.status === 'working'
    || row.status === 'queued'
    || row.status === 'blocked'
    || row.status === 'permission'
    || row.status === 'question'
  )).length,
  total: rows.length,
});

const finiteNonNegative = (value: unknown): number | null => (
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
);

/** Sum only usage dimensions reported by at least one child. */
export const aggregateWorkStatusSubagentUsage = (
  rows: readonly WorkStatusSubagentRow[],
): WorkStatusSubagentUsage | null => {
  let tokens = 0;
  let cost = 0;
  let hasTokens = false;
  let hasCost = false;
  for (const row of rows) {
    const rowTokens = finiteNonNegative(row.usage?.tokens);
    const rowCost = finiteNonNegative(row.usage?.cost);
    if (rowTokens !== null) {
      tokens += rowTokens;
      hasTokens = true;
    }
    if (rowCost !== null) {
      cost += rowCost;
      hasCost = true;
    }
  }
  if (!hasTokens && !hasCost) return null;
  return {
    ...(hasTokens ? { tokens } : {}),
    ...(hasCost ? { cost } : {}),
  };
};

const formatTokenCount = (tokens: number): string => {
  if (tokens < 1000) return String(Math.round(tokens));
  if (tokens < 1_000_000) return `${(tokens / 1000).toFixed(tokens < 100_000 ? 1 : 0).replace(/\.0$/, '')}k`;
  return `${(tokens / 1_000_000).toFixed(tokens < 10_000_000 ? 1 : 0).replace(/\.0$/, '')}M`;
};

const formatUsageCost = (cost: number): string => {
  const fixed = cost.toFixed(4);
  return `$${fixed.includes('.') ? fixed.replace(/0+$/, '').replace(/\.$/, '') : fixed}`;
};

/** Compact, readable child-row usage. Null means the API has no usage yet. */
export const formatWorkStatusSubagentUsage = (
  usage: WorkStatusSubagentUsage | null | undefined,
  labels: { tokens?: string } = {},
): string | null => {
  if (!usage) return null;
  const parts: string[] = [];
  const tokens = finiteNonNegative(usage.tokens);
  const cost = finiteNonNegative(usage.cost);
  if (tokens !== null) parts.push(`${formatTokenCount(tokens)} ${labels.tokens ?? 'tokens'}`);
  if (cost !== null) parts.push(formatUsageCost(cost));
  return parts.length > 0 ? parts.join(' · ') : null;
};

export const formatWorkStatusSubagentSummary = (
  summary: WorkStatusSubagentSummary,
  labels: { queued: string; done: string },
): string | number => {
  if (summary.queuedUnopenable > 0) {
    return `${summary.queuedUnopenable} ${labels.queued} · ${summary.openable} ${labels.done}`;
  }
  if (summary.busy > 0) {
    return `${summary.busy}/${summary.total}`;
  }
  return summary.total;
};
