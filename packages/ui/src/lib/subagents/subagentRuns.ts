export type SubagentRunState = 'queued' | 'running' | 'blocked' | 'paused' | 'done' | 'failed' | 'stopped';
export type SubagentRunMode = 'foreground' | 'background';
export type SubagentRunBlocker = 'question' | 'permission';

export type SubagentRun = {
  runId: string;
  parentID: string | null;
  sessionID: string | null;
  directory: string | null;
  toolCallId?: string | null;
  name: string;
  role: string;
  mode: SubagentRunMode;
  state: SubagentRunState;
  title: string;
  openable: boolean;
  blocker?: SubagentRunBlocker;
};

const STATES = new Set<SubagentRunState>(['queued', 'running', 'blocked', 'paused', 'done', 'failed', 'stopped']);
const MODES = new Set<SubagentRunMode>(['foreground', 'background']);

const asTrimmed = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const parseSubagentRun = (value: unknown): SubagentRun | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const runId = asTrimmed(record.runId);
  const name = asTrimmed(record.name) || 'subagent';
  const state = asTrimmed(record.state) as SubagentRunState;
  const mode = asTrimmed(record.mode) as SubagentRunMode;
  if (!runId || !STATES.has(state) || !MODES.has(mode)) return null;
  const sessionID = asTrimmed(record.sessionID) || null;
  const directory = asTrimmed(record.directory) || null;
  const toolCallId = asTrimmed(record.toolCallId) || null;
  const blocker = asTrimmed(record.blocker);
  return {
    runId,
    parentID: asTrimmed(record.parentID) || null,
    sessionID,
    directory,
    toolCallId,
    name,
    role: asTrimmed(record.role) || name,
    mode,
    state,
    title: asTrimmed(record.title) || name,
    openable: record.openable === true && Boolean(sessionID),
    ...(blocker === 'question' || blocker === 'permission' ? { blocker } : {}),
  };
};

export const parseSubagentRunsPayload = (value: unknown): SubagentRun[] | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const runs = (value as { runs?: unknown }).runs;
  if (!Array.isArray(runs)) return null;
  return runs.flatMap((item) => {
    const parsed = parseSubagentRun(item);
    return parsed ? [parsed] : [];
  });
};
