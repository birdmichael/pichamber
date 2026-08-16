import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ASYNC_RUNS_DIR = 'async-subagent-runs';
const STATUS_FILE = 'status.json';
const ACTIVE_STATES = new Set(['queued', 'running']);
const BLOCKED_STATES = new Set(['blocked', 'paused']);
const DONE_STATES = new Set(['complete', 'completed', 'done', 'success']);
const FAILED_STATES = new Set(['failed', 'error', 'rejected']);
const STOPPED_STATES = new Set(['stopped', 'cancelled', 'canceled']);

const isRecord = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const asTrimmedString = (value) => (typeof value === 'string' && value.trim() ? value.trim() : '');

export const isSubagentsSlotActive = (payload) => {
  const slot = payload?.slots?.subagents ?? payload?.subagents;
  return Boolean(slot?.installed && slot?.enabled);
};

export const normalizeSubagentRunState = (value) => {
  const state = asTrimmedString(value).toLowerCase();
  if (ACTIVE_STATES.has(state)) return 'running';
  if (BLOCKED_STATES.has(state) || state === 'blocked') return state === 'paused' ? 'paused' : 'blocked';
  if (DONE_STATES.has(state)) return 'done';
  if (FAILED_STATES.has(state)) return 'failed';
  if (STOPPED_STATES.has(state)) return 'stopped';
  if (state === 'queued') return 'queued';
  return state || 'running';
};

export const normalizeSubagentRunMode = (value, fallback = 'foreground') => {
  const mode = asTrimmedString(value).toLowerCase();
  if (mode === 'background' || mode === 'async' || mode === 'detached') return 'background';
  if (mode === 'foreground' || mode === 'sync') return 'foreground';
  if (mode === 'workflow' || mode === 'chain' || mode === 'parallel') return 'background';
  return fallback;
};

export const readSessionIdFromSessionFile = (filePath) => {
  const file = asTrimmedString(filePath);
  if (!file || !fs.existsSync(file)) return '';
  try {
    const fd = fs.openSync(file, 'r');
    try {
      const buffer = Buffer.alloc(8 * 1024);
      const bytes = fs.readSync(fd, buffer, 0, buffer.length, 0);
      const text = buffer.slice(0, bytes).toString('utf8');
      const firstLine = text.split(/\r?\n/).find((line) => line.trim());
      if (!firstLine) return '';
      const parsed = JSON.parse(firstLine);
      return asTrimmedString(parsed?.id);
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return '';
  }
};

export const parentSessionMatches = (statusSessionId, parent = {}) => {
  const candidate = asTrimmedString(statusSessionId);
  if (!candidate) return false;
  const ids = [
    parent.id,
    parent.sessionFile,
    typeof parent.sessionManager?.getSessionId === 'function' ? parent.sessionManager.getSessionId() : '',
    typeof parent.sessionManager?.getSessionFile === 'function' ? parent.sessionManager.getSessionFile() : '',
    parent.info?.id,
  ].map(asTrimmedString).filter(Boolean);
  if (ids.includes(candidate)) return true;
  return ids.some((id) => (
    candidate.endsWith(id)
    || id.endsWith(candidate)
    || path.basename(candidate) === path.basename(id)
  ));
};

const readJsonFile = (filePath) => {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

const firstStepSessionFile = (status) => {
  const steps = Array.isArray(status?.steps) ? status.steps : [];
  for (const step of steps) {
    const file = asTrimmedString(step?.sessionFile);
    if (file) return file;
  }
  const results = Array.isArray(status?.results) ? status.results : [];
  for (const result of results) {
    const file = asTrimmedString(result?.sessionFile);
    if (file) return file;
  }
  return '';
};

const firstAgentName = (status) => {
  const steps = Array.isArray(status?.steps) ? status.steps : [];
  for (const step of steps) {
    const agent = asTrimmedString(step?.agent || step?.label);
    if (agent) return agent;
  }
  return asTrimmedString(status?.agent || status?.role);
};

export const mapStatusToSubagentRun = (status, {
  parentID,
  asyncDir,
} = {}) => {
  if (!isRecord(status)) return null;
  const runId = asTrimmedString(status.runId || status.id);
  if (!runId) return null;
  const sessionFile = asTrimmedString(status.sessionFile) || firstStepSessionFile(status);
  const childSessionID = asTrimmedString(status.childSessionId)
    || readSessionIdFromSessionFile(sessionFile);
  const agent = firstAgentName(status) || 'subagent';
  const state = normalizeSubagentRunState(status.state);
  const mode = normalizeSubagentRunMode(status.mode, sessionFile ? 'background' : 'foreground');
  return {
    runId,
    parentID: asTrimmedString(parentID),
    sessionID: childSessionID || null,
    sessionFile: sessionFile || null,
    name: agent,
    role: asTrimmedString(status.role) || agent,
    mode,
    state,
    title: asTrimmedString(status.goal || status.task) || agent,
    toolCallId: asTrimmedString(status.toolCallId) || null,
    asyncDir: asTrimmedString(asyncDir) || null,
    startedAt: typeof status.startedAt === 'number' ? status.startedAt : null,
    endedAt: typeof status.endedAt === 'number' ? status.endedAt : null,
  };
};

const listAsyncRunDirs = (root) => {
  if (!root || !fs.existsSync(root)) return [];
  try {
    return fs.readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name !== '.active-runs')
      .map((entry) => path.join(root, entry.name));
  } catch {
    return [];
  }
};

export const listAsyncSubagentRunRoots = ({
  tmpdir = process.env.TMPDIR || os.tmpdir(),
  projectDir,
} = {}) => {
  const roots = [];
  const seen = new Set();
  const add = (value) => {
    const resolved = asTrimmedString(value);
    if (!resolved || seen.has(resolved)) return;
    seen.add(resolved);
    roots.push(resolved);
  };

  if (projectDir) {
    add(path.join(projectDir, '.pi', 'subagents', ASYNC_RUNS_DIR));
  }

  try {
    for (const entry of fs.readdirSync(tmpdir, { withFileTypes: true })) {
      if (!entry.isDirectory() || !entry.name.startsWith('pi-subagents-')) continue;
      add(path.join(tmpdir, entry.name, ASYNC_RUNS_DIR));
    }
  } catch {
  }

  return roots;
};

export const listAdapterRunsFromFiles = ({
  parent,
  tmpdir = process.env.TMPDIR || os.tmpdir(),
  projectDir,
} = {}) => {
  const runs = [];
  const seen = new Set();
  for (const root of listAsyncSubagentRunRoots({ tmpdir, projectDir })) {
    for (const asyncDir of listAsyncRunDirs(root)) {
      const status = readJsonFile(path.join(asyncDir, STATUS_FILE));
      if (!status) continue;
      if (parent && !parentSessionMatches(status.sessionId, parent)) continue;
      const run = mapStatusToSubagentRun(status, {
        parentID: parent?.id,
        asyncDir,
      });
      if (!run || seen.has(run.runId)) continue;
      seen.add(run.runId);
      runs.push(run);
    }
  }
  return runs;
};

const parseJsonValue = (value) => {
  if (isRecord(value)) return value;
  const text = asTrimmedString(value);
  if (!text) return null;
  try {
    const parsed = JSON.parse(text);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

export const extractSubagentRunFromToolPart = (part, parentID) => {
  if (!isRecord(part) || asTrimmedString(part.tool).toLowerCase() !== 'subagent') return null;
  const state = isRecord(part.state) ? part.state : {};
  const input = isRecord(state.input) ? state.input : (isRecord(part.input) ? part.input : {});
  const output = parseJsonValue(state.output) || parseJsonValue(part.output) || {};
  const details = isRecord(output.details) ? output.details : output;
  const agent = asTrimmedString(input.agent || details.agent || input.subagent_type) || 'subagent';
  const runId = asTrimmedString(
    details.runId
    || details.id
    || input.id
    || input.runId
    || part.callID
    || part.id,
  );
  if (!runId) return null;
  const sessionFile = asTrimmedString(details.sessionFile || input.sessionFile);
  const childSessionID = asTrimmedString(details.childSessionId || details.sessionId || input.sessionId)
    || readSessionIdFromSessionFile(sessionFile);
  const toolStatus = asTrimmedString(state.status).toLowerCase();
  const stateFromOutput = asTrimmedString(details.state || output.state);
  const running = !toolStatus || toolStatus === 'pending' || toolStatus === 'running';
  return {
    runId,
    parentID: asTrimmedString(parentID),
    sessionID: childSessionID && childSessionID !== parentID ? childSessionID : (readSessionIdFromSessionFile(sessionFile) || null),
    sessionFile: sessionFile || null,
    name: agent,
    role: asTrimmedString(input.role) || agent,
    mode: normalizeSubagentRunMode(
      details.mode || input.mode || (input.async === true ? 'background' : 'foreground'),
      input.async === true ? 'background' : 'foreground',
    ),
    state: normalizeSubagentRunState(stateFromOutput || (running ? 'running' : 'done')),
    title: asTrimmedString(input.task || input.description || details.goal) || agent,
    toolCallId: asTrimmedString(part.callID || part.id) || null,
    asyncDir: null,
    startedAt: typeof state.time?.start === 'number' ? state.time.start : null,
    endedAt: typeof state.time?.end === 'number' ? state.time.end : null,
  };
};

export const extractRunsFromFacadeMessages = (messages, parentID) => {
  const runs = [];
  const seen = new Set();
  for (const entry of Array.isArray(messages) ? messages : []) {
    for (const part of Array.isArray(entry?.parts) ? entry.parts : []) {
      const run = extractSubagentRunFromToolPart(part, parentID);
      if (!run || seen.has(run.runId)) continue;
      seen.add(run.runId);
      runs.push(run);
    }
  }
  return runs;
};

const runRank = (state) => {
  switch (state) {
    case 'running':
    case 'queued':
      return 0;
    case 'blocked':
    case 'paused':
      return 1;
    case 'failed':
    case 'stopped':
      return 2;
    default:
      return 3;
  }
};

export const mergeSubagentRuns = (...lists) => {
  const byId = new Map();
  for (const list of lists) {
    for (const run of Array.isArray(list) ? list : []) {
      if (!run?.runId) continue;
      const existing = byId.get(run.runId);
      if (!existing) {
        byId.set(run.runId, { ...run });
        continue;
      }
      byId.set(run.runId, {
        ...existing,
        ...run,
        sessionID: run.sessionID || existing.sessionID,
        sessionFile: run.sessionFile || existing.sessionFile,
        name: run.name && run.name !== 'subagent' ? run.name : existing.name,
        role: run.role && run.role !== 'subagent' ? run.role : existing.role,
        title: run.title && run.title !== run.name ? run.title : existing.title,
      });
    }
  }
  return [...byId.values()].sort((left, right) => {
    const byState = runRank(left.state) - runRank(right.state);
    if (byState !== 0) return byState;
    return (right.startedAt || 0) - (left.startedAt || 0);
  });
};

export const toPublicSubagentRun = (run) => ({
  runId: run.runId,
  parentID: run.parentID || null,
  sessionID: run.sessionID || null,
  name: run.name,
  role: run.role,
  mode: run.mode,
  state: run.state,
  title: run.title,
  openable: Boolean(run.sessionID),
});

export const findAdapterRunByChildSessionId = (sessionID, options = {}) => {
  const id = asTrimmedString(sessionID);
  if (!id) return null;
  const runs = listAdapterRunsFromFiles(options);
  return runs.find((run) => run.sessionID === id) || null;
};
