import { readTaskSessionIdFromOutput, readTaskSessionIdFromRecord } from '@/components/chat/message/parts/taskToolModel';

import { canOpenSubagentChildSession, resolveSubagentChildDirectory } from './childSession';
import { readSubagentChildSessionId } from './subagentTool';
import type { SubagentRun } from './subagentRuns';

export type WorkStatusSubagentRow = {
  id: string;
  label: string;
  sessionID: string | null;
  directory: string | null;
  openable: boolean;
  status: 'permission' | 'question' | 'working' | 'blocked' | 'failed' | 'paused' | 'done';
  mode?: 'foreground' | 'background';
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
    const status: WorkStatusSubagentRow['status'] = run.state === 'running' || run.state === 'queued'
      ? 'working'
      : run.state === 'blocked'
        ? 'blocked'
        : run.state === 'paused'
          ? 'paused'
          : run.state === 'failed' || run.state === 'stopped'
            ? 'failed'
            : 'done';
    return {
      id: run.runId,
      label: run.title?.trim() || run.name || untitledLabel,
      sessionID: opened.sessionID,
      directory: opened.directory,
      openable: opened.openable,
      mode: run.mode,
      status,
    };
  });
  return rows.filter((row) => (
    row.openable
    || row.status === 'working'
    || row.status === 'blocked'
    || row.status === 'paused'
  ));
};
