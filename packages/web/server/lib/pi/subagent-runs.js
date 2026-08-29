import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ASYNC_RUNS_DIR = 'async-subagent-runs';
const STATUS_FILE = 'status.json';
const ACTIVE_STATES = new Set(['running']);
const BLOCKED_STATES = new Set(['blocked', 'paused']);
const DONE_STATES = new Set(['complete', 'completed', 'done', 'success']);
const FAILED_STATES = new Set(['failed', 'error', 'rejected']);
const STOPPED_STATES = new Set(['stopped', 'cancelled', 'canceled']);

const isRecord = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const asTrimmedString = (value) => (typeof value === 'string' && value.trim() ? value.trim() : '');

const asChildSessionId = (sessionID, parentID) => {
  const child = asTrimmedString(sessionID);
  const parent = asTrimmedString(parentID);
  if (!child || (parent && child === parent)) return null;
  return child;
};


export const isSubagentsSlotActive = (payload) => {
  const slot = payload?.slots?.subagents ?? payload?.subagents;
  return Boolean(slot?.installed && slot?.enabled);
};

export const normalizeSubagentRunState = (value) => {
  const state = asTrimmedString(value).toLowerCase();
  if (state === 'queued') return 'queued';
  if (ACTIVE_STATES.has(state)) return 'running';
  if (BLOCKED_STATES.has(state) || state === 'blocked') return state === 'paused' ? 'paused' : 'blocked';
  if (DONE_STATES.has(state)) return 'done';
  if (FAILED_STATES.has(state)) return 'failed';
  if (STOPPED_STATES.has(state)) return 'stopped';
  return state || 'running';
};

export const normalizeSubagentRunMode = (value, fallback = 'foreground') => {
  const mode = asTrimmedString(value).toLowerCase();
  if (mode === 'management') return null;
  if (mode === 'background' || mode === 'async' || mode === 'detached') return 'background';
  if (mode === 'foreground' || mode === 'sync') return 'foreground';
  if (mode === 'workflow' || mode === 'chain' || mode === 'parallel') return 'background';
  return fallback;
};

const readSessionHeaderFromSessionFile = (filePath) => {
  const file = asTrimmedString(filePath);
  if (!file || !fs.existsSync(file)) return { id: '', cwd: '' };
  try {
    const fd = fs.openSync(file, 'r');
    try {
      const buffer = Buffer.alloc(8 * 1024);
      const bytes = fs.readSync(fd, buffer, 0, buffer.length, 0);
      const text = buffer.slice(0, bytes).toString('utf8');
      const firstLine = text.split(/\r?\n/).find((line) => line.trim());
      if (!firstLine) return { id: '', cwd: '' };
      const parsed = JSON.parse(firstLine);
      return {
        id: asTrimmedString(parsed?.id),
        cwd: asTrimmedString(parsed?.cwd),
      };
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return { id: '', cwd: '' };
  }
};

export const readSessionIdFromSessionFile = (filePath) => readSessionHeaderFromSessionFile(filePath).id;

export const readSessionCwdFromSessionFile = (filePath) => readSessionHeaderFromSessionFile(filePath).cwd;

const sessionPathStem = (value) => {
  const name = path.basename(asTrimmedString(value));
  return name.endsWith('.jsonl') ? name.slice(0, -'.jsonl'.length) : name;
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
  const candidateStem = sessionPathStem(candidate);
  return ids.some((id) => (
    candidate.endsWith(id)
    || id.endsWith(candidate)
    || path.basename(candidate) === path.basename(id)
    // Adapter status.sessionId is the parent jsonl path. Untitled chats store
    // `{timestamp}_{piId}.jsonl`; parent.id is only the Pi header id.
    || candidateStem === id
    || candidateStem.endsWith(`_${id}`)
    || candidateStem.endsWith(`-${id}`)
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
    const agent = asTrimmedString(step?.agent);
    if (agent) return agent;
  }
  return asTrimmedString(status?.agent || status?.role);
};

const firstStepLabel = (status) => {
  const steps = Array.isArray(status?.steps) ? status.steps : [];
  for (const step of steps) {
    const label = asTrimmedString(step?.label || step?.workflowKey);
    if (label) return label;
  }
  return '';
};

const adapterSteps = (status) => (Array.isArray(status?.steps) ? status.steps : []);

export const isLiveRunState = (state) => (
  state === 'queued' || state === 'running' || state === 'blocked' || state === 'paused'
);

/**
 * Workflow `status.json` often stays `complete` after the parent tool detaches
 * while a child step is still running or waiting on the supervisor.
 */
export const readAdapterLifecycleState = (status) => {
  const stepStates = adapterSteps(status).map((step) => (
    normalizeSubagentRunState(step?.status || step?.state)
  ));
  const live = stepStates.find((state) => isLiveRunState(state));
  if (live) return live;
  if (stepStates.includes('failed')) return 'failed';
  if (stepStates.includes('stopped')) return 'stopped';
  return normalizeSubagentRunState(status?.state);
};

const readAdapterBlocker = (source) => {
  if (!isRecord(source)) return null;
  const tool = asTrimmedString(source.currentTool).toLowerCase();
  const args = asTrimmedString(source.currentToolArgs).toLowerCase();
  if (tool === 'contact_supervisor' || args.includes('interview')) return 'question';
  if (tool === 'question' || tool.endsWith('_question')) return 'question';
  return null;
};

const readStatusBlocker = (status, step) => {
  if (step) return readAdapterBlocker(step);
  const liveStep = adapterSteps(status).find((item) => (
    isLiveRunState(normalizeSubagentRunState(item?.status || item?.state))
  ));
  return readAdapterBlocker(liveStep) || readAdapterBlocker(status);
};

/**
 * Async `workflowScript` launches omit top-level `agent` / `task`. The name
 * lives in `runs.run("disk-scan", { agent: "worker", task: \`…\` })`.
 */
export const readWorkflowScriptHints = (script) => {
  const text = asTrimmedString(script);
  if (!text) return { agent: '', label: '', task: '' };
  const readQuoted = (from) => {
    if (from < 0) return '';
    let index = from;
    while (index < text.length && /\s/.test(text[index])) index += 1;
    const quote = text[index];
    if (quote !== '"' && quote !== "'") return '';
    const end = text.indexOf(quote, index + 1);
    return end > index ? text.slice(index + 1, end) : '';
  };
  const runAt = text.indexOf('runs.run(');
  const label = runAt >= 0 ? readQuoted(runAt + 'runs.run('.length) : '';
  const agentKey = text.match(/\bagent\s*:/);
  const agent = agentKey ? readQuoted(agentKey.index + agentKey[0].length) : '';
  return { agent: asTrimmedString(agent), label: asTrimmedString(label), task: '' };
};

export const mapStatusToSubagentRun = (status, {
  parentID,
  asyncDir,
} = {}) => {
  if (!isRecord(status)) return null;
  if (isSubagentManagementCall({ input: status, details: status, status, mode: status.mode })) {
    return null;
  }
  const runId = asTrimmedString(status.runId || status.id);
  if (!runId) return null;
  const sessionFile = asTrimmedString(status.sessionFile) || firstStepSessionFile(status);
  const childSessionID = resolveChildSessionId({
    parentID,
    sessionFile,
    candidates: [status.childSessionId],
  });
  const agent = firstAgentName(status) || 'subagent';
  const state = readAdapterLifecycleState(status);
  const mode = normalizeSubagentRunMode(status.mode, sessionFile ? 'background' : 'foreground');
  if (!mode) return null;
  const blocker = readStatusBlocker(status);
  return {
    runId,
    parentID: asTrimmedString(parentID),
    sessionID: childSessionID || null,
    sessionFile: sessionFile || null,
    directory: readSessionCwdFromSessionFile(sessionFile) || asTrimmedString(status.cwd || status.directory) || null,
    name: agent,
    role: asTrimmedString(status.role) || agent,
    mode,
    state,
    title: asTrimmedString(status.goal || status.task) || firstStepLabel(status) || agent,
    toolCallId: asTrimmedString(status.toolCallId) || null,
    asyncDir: asTrimmedString(asyncDir) || null,
    startedAt: typeof status.startedAt === 'number' ? status.startedAt : null,
    endedAt: typeof status.endedAt === 'number' ? status.endedAt : null,
    ...(blocker ? { blocker } : {}),
  };
};

const mapStepToSubagentRun = (status, step, {
  parentID,
  asyncDir,
  index,
} = {}) => {
  const base = mapStatusToSubagentRun(status, { parentID, asyncDir });
  if (!base || !isRecord(step)) return null;
  const sessionFile = asTrimmedString(step.sessionFile);
  const sessionID = resolveChildSessionId({
    parentID,
    sessionFile,
    candidates: [step.childSessionId, step.sessionId, step.sessionID],
  });
  const name = asTrimmedString(step.agent) || base.name;
  const title = asTrimmedString(step.label || step.workflowKey || step.task) || name;
  const state = normalizeSubagentRunState(step.status || step.state || status.state);
  const blocker = readStatusBlocker(status, step);
  const stepRunId = asTrimmedString(step.runId);
  const next = {
    ...base,
    runId: sessionID
      ? `${base.runId}:${sessionID}`
      : (stepRunId && stepRunId !== base.runId ? `${base.runId}:${stepRunId}` : `${base.runId}:${index}`),
    sessionFile: sessionFile || base.sessionFile,
    sessionID: sessionID || null,
    name,
    role: asTrimmedString(step.role) || name,
    state,
    title,
    startedAt: typeof step.startedAt === 'number' ? step.startedAt : base.startedAt,
    endedAt: typeof step.endedAt === 'number' ? step.endedAt : base.endedAt,
  };
  if (blocker) next.blocker = blocker;
  else delete next.blocker;
  return next;
};

/**
 * One workflow `runId` can fan out to several child session files. Collapse
 * only when there is a single child (or none yet). Different sessionIDs stay
 * separate rows so Work Status does not hide a finished sibling.
 */
export const mapStatusToSubagentRuns = (status, options = {}) => {
  const base = mapStatusToSubagentRun(status, options);
  if (!base) return [];
  const steps = adapterSteps(status).filter((step) => (
    asTrimmedString(step?.sessionFile)
    || isLiveRunState(normalizeSubagentRunState(step?.status || step?.state))
  ));
  const childFiles = steps.filter((step) => asTrimmedString(step?.sessionFile));
  if (childFiles.length <= 1) return [base];
  return childFiles.map((step, index) => mapStepToSubagentRun(status, step, {
    parentID: options.parentID,
    asyncDir: options.asyncDir,
    index,
  })).filter(Boolean);
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

export const listGitWorktreePaths = (projectDir) => {
  const root = asTrimmedString(projectDir);
  if (!root) return [];
  try {
    const output = execFileSync('git', ['-C', root, 'worktree', 'list', '--porcelain'], {
      encoding: 'utf8',
      timeout: 3000,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const paths = [];
    for (const line of output.split(/\r?\n/)) {
      if (!line.startsWith('worktree ')) continue;
      const worktree = line.slice('worktree '.length).trim();
      if (worktree) paths.push(worktree);
    }
    return paths;
  } catch {
    return [];
  }
};

const listRelatedProjectDirs = ({
  projectDir,
  extraProjectDirs,
} = {}) => {
  const dirs = [];
  const seen = new Set();
  const add = (value) => {
    const resolved = asTrimmedString(value);
    if (!resolved || seen.has(resolved)) return;
    seen.add(resolved);
    dirs.push(resolved);
  };
  add(projectDir);
  for (const extra of Array.isArray(extraProjectDirs) ? extraProjectDirs : []) {
    add(extra);
  }
  for (const worktree of listGitWorktreePaths(projectDir)) {
    add(worktree);
  }
  return dirs;
};

const listAsyncSubagentRunRoots = ({
  tmpdir = process.env.TMPDIR || os.tmpdir(),
  projectDir,
  extraProjectDirs,
} = {}) => {
  const roots = [];
  const seen = new Set();
  const add = (value) => {
    const resolved = asTrimmedString(value);
    if (!resolved || seen.has(resolved)) return;
    seen.add(resolved);
    roots.push(resolved);
  };

  for (const dir of listRelatedProjectDirs({ projectDir, extraProjectDirs })) {
    add(path.join(dir, '.pi', 'subagents', ASYNC_RUNS_DIR));
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
  extraProjectDirs,
} = {}) => {
  const runs = [];
  const seen = new Set();
  for (const root of listAsyncSubagentRunRoots({ tmpdir, projectDir, extraProjectDirs })) {
    for (const asyncDir of listAsyncRunDirs(root)) {
      const status = readJsonFile(path.join(asyncDir, STATUS_FILE));
      if (!status) continue;
      if (parent && !parentSessionMatches(status.sessionId, parent)) continue;
      for (const run of mapStatusToSubagentRuns(status, {
        parentID: parent?.id,
        asyncDir,
      })) {
        if (!run || seen.has(run.runId)) continue;
        seen.add(run.runId);
        runs.push(run);
      }
    }
  }
  return runs;
};

const NESTED_RUN_WALK_MAX_DEPTH = 6;
const NESTED_RUN_WALK_MAX_FILES = 64;

const walkNestedRunSessionFiles = (root) => {
  const files = [];
  const walk = (current, depth) => {
    if (files.length >= NESTED_RUN_WALK_MAX_FILES || depth > NESTED_RUN_WALK_MAX_DEPTH) return;
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (files.length >= NESTED_RUN_WALK_MAX_FILES) return;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'archive' || entry.name === 'node_modules' || entry.name === '.git') continue;
        walk(full, depth + 1);
        continue;
      }
      if (entry.isFile() && entry.name === 'session.jsonl') {
        const runDir = path.basename(path.dirname(full));
        if (runDir.startsWith('run-')) files.push(full);
      }
    }
  };
  walk(root, 0);
  return files;
};

const inferNestedRunMeta = (file, parentID) => {
  const named = path.basename(path.dirname(path.dirname(file)));
  const parent = asTrimmedString(parentID);
  const runId = named && named !== parent ? named : path.basename(path.dirname(file));
  const name = runId.startsWith('run_') ? runId.slice('run_'.length) : runId;
  return { runId, name: name || 'subagent' };
};

/** Pi stores worktree children as `<parentSessionDir>/<parentId>/<runName>/run-N/session.jsonl`. */
export const listNestedSessionRuns = ({
  parent,
  sessionDir,
} = {}) => {
  const parentID = asTrimmedString(parent?.id);
  if (!parentID) return [];
  const roots = [];
  const seenRoots = new Set();
  const addRoot = (value) => {
    const dir = asTrimmedString(value);
    if (!dir || seenRoots.has(dir)) return;
    seenRoots.add(dir);
    if (fs.existsSync(dir)) roots.push(dir);
  };
  if (parent?.sessionFile) {
    addRoot(path.join(path.dirname(parent.sessionFile), parentID));
  }
  if (sessionDir) {
    addRoot(path.join(sessionDir, parentID));
  }

  const runs = [];
  const seen = new Set();
  for (const root of roots) {
    for (const file of walkNestedRunSessionFiles(root)) {
      if (seen.has(file)) continue;
      seen.add(file);
      const header = readSessionHeaderFromSessionFile(file);
      const childId = asChildSessionId(header.id, parentID);
      if (!childId) continue;
      const { runId, name } = inferNestedRunMeta(file, parentID);
      let startedAt = null;
      try {
        const mtime = fs.statSync(file).mtimeMs;
        if (Number.isFinite(mtime)) startedAt = mtime;
      } catch {
      }
      runs.push({
        runId,
        parentID,
        sessionID: childId,
        sessionFile: file,
        directory: header.cwd || null,
        name,
        role: name,
        mode: 'background',
        state: 'done',
        title: name,
        toolCallId: null,
        asyncDir: null,
        startedAt,
        endedAt: null,
      });
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

const hasSubagentExecutionPayload = (value) => {
  if (!isRecord(value)) return false;
  if (asTrimmedString(value.task) || asTrimmedString(value.workflowScript)) return true;
  if (Array.isArray(value.tasks) && value.tasks.length > 0) return true;
  if (Array.isArray(value.chain) && value.chain.length > 0) return true;
  return false;
};

const readSubagentAction = (...values) => {
  for (const value of values) {
    if (!isRecord(value)) continue;
    const action = asTrimmedString(value.action);
    if (action) return action.toLowerCase();
  }
  return '';
};

const readSubagentDeclaredMode = (...values) => {
  for (const value of values) {
    if (!isRecord(value)) continue;
    const mode = asTrimmedString(value.mode);
    if (mode) return mode.toLowerCase();
  }
  return '';
};

const SUBAGENT_DUMP_TEXT = /^(debug run|status target:|run lifecycle debug)\b/im;

const isSubagentDumpOutput = (value) => {
  if (typeof value === 'string') return SUBAGENT_DUMP_TEXT.test(value.trim());
  if (Array.isArray(value)) {
    return value.some((item) => typeof item?.text === 'string' && SUBAGENT_DUMP_TEXT.test(item.text.trim()));
  }
  return false;
};

const isSubagentDumpDetails = (details) => {
  if (!isRecord(details) || hasSubagentExecutionPayload(details)) return false;
  if (asTrimmedString(details.sessionFile) || asTrimmedString(details.childSessionId)) return false;
  return Boolean(details.lifecycleStatus) && Array.isArray(details.results);
};

/**
 * Catalog / CRUD / status / debug dumps are not fleet children. pi-subagents
 * marks those results `mode: "management"` and omits execution fields (`task`,
 * `tasks`, `chain`, `workflowScript`). Status and `debug.run` toolResults
 * often keep `mode: "single"` and only put `action` on the toolCall — the
 * dump text / `lifecycleStatus` shape still counts as management.
 */
export const isSubagentManagementCall = (payload = {}) => {
  const input = isRecord(payload.input) ? payload.input : {};
  const details = isRecord(payload.details) ? payload.details : {};
  const output = isRecord(payload.output) ? payload.output : (parseJsonValue(payload.output) || {});
  const outputDetails = isRecord(output.details) ? output.details : output;
  const status = isRecord(payload.status) ? payload.status : {};
  if (hasSubagentExecutionPayload(input)
    || hasSubagentExecutionPayload(details)
    || hasSubagentExecutionPayload(outputDetails)
    || hasSubagentExecutionPayload(status)
    || hasSubagentExecutionPayload(payload)) {
    return false;
  }
  if (isSubagentDumpOutput(payload.output)
    || isSubagentDumpOutput(output)
    || isSubagentDumpDetails(details)
    || isSubagentDumpDetails(outputDetails)
    || isSubagentDumpDetails(status)) {
    return true;
  }
  const mode = readSubagentDeclaredMode(
    payload,
    input,
    details,
    outputDetails,
    output,
    status,
  );
  if (mode === 'management') return true;
  return Boolean(readSubagentAction(input, details, outputDetails, output, status, payload));
};

const readSessionIdFromRecord = (value) => {
  if (!isRecord(value)) return '';
  return asTrimmedString(value.childSessionId)
    || asTrimmedString(value.sessionID)
    || asTrimmedString(value.sessionId)
    || (isRecord(value.details) ? readSessionIdFromRecord(value.details) : '');
};

const readSessionIdFromOutputText = (value) => {
  const text = asTrimmedString(value);
  if (!text) return '';
  const parsed = parseJsonValue(text);
  if (parsed) return readSessionIdFromRecord(parsed);
  const sessionMatch = text.match(/session(?:Id|_id|[_\s-]id)\s*[:=]\s*["']?([^\s<"']+)/i);
  return asTrimmedString(sessionMatch?.[1]);
};

const SESSION_FILE_TEXT_LIMIT = 32 * 1024;
const JSONL_SUFFIX = '.jsonl';

const isSessionPathStop = (ch) => (
  ch === ' '
  || ch === '\t'
  || ch === '\n'
  || ch === '\r'
  || ch === '"'
  || ch === "'"
  || ch === '<'
  || ch === '>'
);

/** Linear scan: find `/…jsonl` without nested-quantifier backtracking. */
const findAbsoluteJsonlPath = (text) => {
  let from = 0;
  while (from < text.length) {
    const suffixAt = text.indexOf(JSONL_SUFFIX, from);
    if (suffixAt === -1) return '';
    const end = suffixAt + JSONL_SUFFIX.length;
    const next = text[end];
    if (next && !isSessionPathStop(next)) {
      from = end;
      continue;
    }
    let start = suffixAt;
    while (start > 0 && !isSessionPathStop(text[start - 1])) {
      start -= 1;
    }
    if (text[start] === '/') return text.slice(start, end);
    from = end;
  }
  return '';
};

export const readSessionFileFromText = (value) => {
  const text = asTrimmedString(value);
  if (!text) return '';
  const haystack = text.length > SESSION_FILE_TEXT_LIMIT
    ? text.slice(0, SESSION_FILE_TEXT_LIMIT)
    : text;
  const labeled = haystack.match(/(?:sessionFile|session_file|session file)\s*[:=]\s*["']?(\S+\.jsonl)/i);
  if (labeled?.[1]) return labeled[1];
  return findAbsoluteJsonlPath(haystack);
};

const resolveChildSessionId = ({
  parentID,
  sessionFile,
  candidates,
} = {}) => {
  const parent = asTrimmedString(parentID);
  for (const candidate of Array.isArray(candidates) ? candidates : []) {
    const id = asTrimmedString(candidate);
    if (id && id !== parent) return id;
  }
  const fromFile = readSessionIdFromSessionFile(sessionFile);
  if (fromFile && fromFile !== parent) return fromFile;
  return null;
};

/** Same fields the transcript card reads: tool input/output sessionId and childSessionId. */
const readChildSessionIdFromToolFields = ({
  parentID,
  input,
  output,
  metadata,
  details,
  sessionFile,
} = {}) => resolveChildSessionId({
  parentID,
  sessionFile,
  candidates: [
    readSessionIdFromRecord(input),
    readSessionIdFromRecord(metadata),
    readSessionIdFromRecord(details),
    readSessionIdFromRecord(output),
    readSessionIdFromOutputText(typeof output === 'string' ? output : ''),
    readSessionIdFromOutputText(typeof details === 'string' ? details : ''),
  ],
});

const sameSubagentRun = (left, right) => {
  const leftSession = asTrimmedString(left?.sessionID);
  const rightSession = asTrimmedString(right?.sessionID);
  if (leftSession && rightSession && leftSession !== rightSession) return false;
  return Boolean(left?.runId && left.runId === right?.runId)
    || Boolean(left?.toolCallId && left.toolCallId === right?.toolCallId)
    || Boolean(leftSession && leftSession === rightSession);
};

export const extractSubagentRunFromToolPart = (part, parentID) => {
  if (!isRecord(part) || asTrimmedString(part.tool).toLowerCase() !== 'subagent') return null;
  const state = isRecord(part.state) ? part.state : {};
  const input = isRecord(state.input) ? state.input : (isRecord(part.input) ? part.input : {});
  const metadata = isRecord(state.metadata) ? state.metadata : (isRecord(part.metadata) ? part.metadata : {});
  const output = parseJsonValue(state.output) || parseJsonValue(part.output) || {};
  const details = isRecord(output.details) ? output.details : output;
  if (isSubagentManagementCall({
    input,
    details,
    output: state.output ?? part.output ?? output,
    metadata,
    mode: details.mode || input.mode || metadata.mode,
  })) {
    return null;
  }
  const hints = readWorkflowScriptHints(input.workflowScript || details.workflowScript);
  const agent = asTrimmedString(
    input.agent || details.agent || metadata.agent || input.subagent_type || hints.agent,
  ) || 'subagent';
  const runId = asTrimmedString(
    details.runId
    || details.id
    || metadata.runId
    || input.id
    || input.runId
    || part.callID
    || part.id,
  );
  if (!runId) return null;
  const rawOutput = typeof state.output === 'string' ? state.output : (typeof part.output === 'string' ? part.output : '');
  const sessionFile = asTrimmedString(details.sessionFile || input.sessionFile || metadata.sessionFile)
    || readSessionFileFromText(rawOutput);
  const childSessionID = readChildSessionIdFromToolFields({
    parentID,
    input,
    output: state.output ?? part.output ?? output,
    metadata,
    details,
    sessionFile,
  });
  const toolStatus = asTrimmedString(state.status).toLowerCase();
  const stateFromOutput = asTrimmedString(details.state || output.state);
  const running = !toolStatus || toolStatus === 'pending' || toolStatus === 'running';
  const mode = normalizeSubagentRunMode(
    details.mode || input.mode || metadata.mode || (input.async === true ? 'background' : 'foreground'),
    input.async === true ? 'background' : 'foreground',
  );
  if (!mode) return null;
  return {
    runId,
    parentID: asTrimmedString(parentID),
    sessionID: childSessionID,
    sessionFile: sessionFile || null,
    directory: readSessionCwdFromSessionFile(sessionFile) || null,
    name: agent,
    role: asTrimmedString(input.role) || agent,
    mode,
    state: normalizeSubagentRunState(stateFromOutput || (running ? 'running' : 'done')),
    title: asTrimmedString(input.task || input.description || details.goal || hints.label) || agent,
    toolCallId: asTrimmedString(part.callID || part.id) || null,
    asyncDir: null,
    startedAt: typeof state.time?.start === 'number' ? state.time.start : null,
    endedAt: typeof state.time?.end === 'number' ? state.time.end : null,
  };
};

const compatibleStoredRun = (existing, run) => {
  const existingSession = asTrimmedString(existing?.sessionID);
  const runSession = asTrimmedString(run?.sessionID);
  if (existingSession && runSession && existingSession !== runSession) return false;
  return true;
};

const findStoredRunId = (byId, run) => {
  if (byId.has(run.runId) && compatibleStoredRun(byId.get(run.runId), run)) return run.runId;
  const toolCallId = asTrimmedString(run.toolCallId);
  if (toolCallId && byId.has(toolCallId) && compatibleStoredRun(byId.get(toolCallId), run)) {
    return toolCallId;
  }
  if (toolCallId) {
    for (const [id, existing] of byId) {
      if (!compatibleStoredRun(existing, run)) continue;
      if (asTrimmedString(existing.toolCallId) === toolCallId || existing.runId === toolCallId) {
        return id;
      }
    }
  }
  for (const [id, existing] of byId) {
    if (!compatibleStoredRun(existing, run)) continue;
    if (asTrimmedString(existing.toolCallId) === run.runId) return id;
  }
  return '';
};

const mergeRunFields = (existing, run) => ({
  ...existing,
  ...run,
  runId: existing.runId === existing.toolCallId && run.runId && run.runId !== run.toolCallId
    ? run.runId
    : existing.runId,
  sessionID: run.sessionID || existing.sessionID,
  sessionFile: run.sessionFile || existing.sessionFile,
  directory: run.directory || existing.directory,
  toolCallId: run.toolCallId || existing.toolCallId,
  name: run.name && run.name !== 'subagent' ? run.name : existing.name,
  role: run.role && run.role !== 'subagent' ? run.role : existing.role,
  title: run.title && run.title !== run.name && run.title !== 'subagent'
    ? run.title
    : (existing.title && existing.title !== 'subagent' ? existing.title : run.title || existing.title),
  blocker: run.blocker || existing.blocker,
});

const upsertSubagentRun = (byId, run) => {
  if (!run?.runId) return;
  const storedId = findStoredRunId(byId, run);
  if (!storedId) {
    byId.set(run.runId, { ...run });
    return;
  }
  const existing = byId.get(storedId);
  const merged = mergeRunFields(existing, run);
  if (storedId !== merged.runId) byId.delete(storedId);
  byId.set(merged.runId, merged);
};

const managementToolCallMatches = (toolCallId, managementCallIds) => {
  const id = asTrimmedString(toolCallId);
  if (!id) return false;
  if (managementCallIds.has(id)) return true;
  for (const known of managementCallIds) {
    if (id === known || id.startsWith(`${known}_`) || id.startsWith(`${known}|`)) return true;
  }
  return false;
};

export const extractRunsFromPiEntries = (entries, parentID) => {
  const byId = new Map();
  const managementCallIds = new Set();
  for (const entry of Array.isArray(entries) ? entries : []) {
    const message = isRecord(entry?.message) ? entry.message : entry;
    if (!isRecord(message)) continue;

    if (asTrimmedString(message.role) === 'assistant' && Array.isArray(message.content)) {
      for (const block of message.content) {
        if (!isRecord(block) || asTrimmedString(block.type) !== 'toolCall') continue;
        if (asTrimmedString(block.name).toLowerCase() !== 'subagent') continue;
        const args = isRecord(block.arguments) ? block.arguments : {};
        if (isSubagentManagementCall({ input: args, details: args, mode: args.mode })) {
          const callId = asTrimmedString(block.id || args.runId || args.id);
          if (callId) managementCallIds.add(callId);
          continue;
        }
        const runId = asTrimmedString(block.id || args.runId || args.id);
        if (!runId) continue;
        const sessionFile = asTrimmedString(args.sessionFile) || null;
        const mode = normalizeSubagentRunMode(args.mode, args.async === true ? 'background' : 'foreground');
        if (!mode) continue;
        const hints = readWorkflowScriptHints(args.workflowScript);
        const agent = asTrimmedString(args.agent || args.role || args.subagent_type || hints.agent) || 'subagent';
        upsertSubagentRun(byId, {
          runId,
          parentID: asTrimmedString(parentID),
          sessionID: readChildSessionIdFromToolFields({ parentID, input: args, sessionFile }),
          sessionFile,
          directory: readSessionCwdFromSessionFile(sessionFile) || null,
          name: agent,
          role: asTrimmedString(args.role || args.agent || hints.agent) || agent,
          mode,
          state: 'running',
          title: asTrimmedString(args.task || args.description || args.goal || hints.label) || agent,
          toolCallId: asTrimmedString(block.id) || null,
          asyncDir: null,
          startedAt: null,
          endedAt: null,
        });
      }
      continue;
    }

    if (asTrimmedString(message.role) !== 'toolResult') continue;
    const toolName = asTrimmedString(message.toolName || message.name).toLowerCase();
    if (toolName !== 'subagent') continue;
    const details = isRecord(message.details) ? message.details : {};
    const runId = asTrimmedString(details.runId || details.id || message.toolCallId || entry.id);
    if (!runId) continue;
    const rawContent = typeof message.content === 'string'
      ? message.content
      : Array.isArray(message.content)
        ? message.content.map((item) => (typeof item?.text === 'string' ? item.text : '')).join('')
        : '';
    if (managementToolCallMatches(message.toolCallId, managementCallIds)
      || isSubagentManagementCall({
        input: details,
        details,
        output: rawContent,
        mode: details.mode,
      })) {
      const storedId = findStoredRunId(byId, { runId, toolCallId: asTrimmedString(message.toolCallId) });
      const existing = storedId ? byId.get(storedId) : null;
      if (existing && !existing.sessionFile && !existing.sessionID) {
        byId.delete(storedId);
      }
      continue;
    }
    const sessionFile = asTrimmedString(details.sessionFile) || readSessionFileFromText(rawContent);
    const mode = normalizeSubagentRunMode(details.mode, sessionFile ? 'background' : 'foreground');
    if (!mode) {
      byId.delete(runId);
      continue;
    }
    const hints = readWorkflowScriptHints(details.workflowScript);
    const agent = asTrimmedString(details.agent || details.role || hints.agent) || 'subagent';
    upsertSubagentRun(byId, {
      runId,
      parentID: asTrimmedString(parentID),
      sessionID: readChildSessionIdFromToolFields({
        parentID,
        input: details,
        output: rawContent,
        details,
        sessionFile,
      }),
      sessionFile: sessionFile || null,
      directory: readSessionCwdFromSessionFile(sessionFile) || asTrimmedString(details.cwd || details.directory) || null,
      name: agent,
      role: asTrimmedString(details.role || details.agent || hints.agent) || agent,
      mode,
      state: normalizeSubagentRunState(details.state || (message.isError ? 'failed' : 'done')),
      title: asTrimmedString(details.goal || details.task || hints.label) || agent,
      toolCallId: asTrimmedString(message.toolCallId || entry.id) || null,
      asyncDir: asTrimmedString(details.asyncDir) || null,
      startedAt: null,
      endedAt: null,
    });
  }
  return [...byId.values()];
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
      upsertSubagentRun(byId, run);
    }
  }
  return [...byId.values()].sort((left, right) => {
    const byState = runRank(left.state) - runRank(right.state);
    if (byState !== 0) return byState;
    return (right.startedAt || 0) - (left.startedAt || 0);
  });
};

/**
 * Live tool-call runs win. Stale adapter status files without a child id are
 * dropped; status-only stays only while a run is still queued/running/blocked.
 * A finished tool-call without a child is not kept so attach cannot mint an
 * empty chat just to make the row clickable.
 */
export const reconcileParentSubagentRuns = (fileRuns, liveRuns) => {
  const live = mergeSubagentRuns(liveRuns);
  const extras = [];
  for (const file of Array.isArray(fileRuns) ? fileRuns : []) {
    if (!file?.runId) continue;
    const match = live.find((run) => sameSubagentRun(run, file));
    if (match) {
      match.sessionID = match.sessionID || file.sessionID;
      match.sessionFile = match.sessionFile || file.sessionFile;
      match.directory = match.directory || file.directory;
      match.toolCallId = match.toolCallId || file.toolCallId;
      if (!match.name || match.name === 'subagent') match.name = file.name;
      if (!match.title || match.title === match.name || match.title === 'subagent') {
        match.title = file.title || match.title;
      }
      if (file.mode) match.mode = file.mode;
      // Adapter status.json is the child lifecycle. The parent tool often
      // completes as soon as the async workflow detaches.
      if (file.state) match.state = file.state;
      if (file.blocker) match.blocker = file.blocker;
      continue;
    }
    const childId = asChildSessionId(file.sessionID, file.parentID);
    if (childId || isLiveRunState(file.state)) extras.push({ ...file, sessionID: childId });
  }

  const visible = mergeSubagentRuns(live, extras).filter((run) => (
    asChildSessionId(run.sessionID, run.parentID)
    || isLiveRunState(run.state)
  ));
  const seenSession = new Set();
  return visible.filter((run) => {
    if (!run.sessionID) return true;
    if (seenSession.has(run.sessionID)) return false;
    seenSession.add(run.sessionID);
    return true;
  });
};

export const toPublicSubagentRun = (run) => {
  const sessionID = asChildSessionId(run.sessionID, run.parentID);
  const toolCallId = asTrimmedString(run.toolCallId);
  const blocker = asTrimmedString(run.blocker);
  return {
    runId: run.runId,
    parentID: run.parentID || null,
    sessionID,
    directory: asTrimmedString(run.directory) || null,
    ...(toolCallId ? { toolCallId } : {}),
    name: run.name,
    role: run.role,
    mode: run.mode,
    state: run.state,
    title: run.title,
    openable: Boolean(sessionID),
    ...(blocker === 'question' || blocker === 'permission' ? { blocker } : {}),
  };
};

export const findAdapterRunByChildSessionId = (sessionID, options = {}) => {
  const id = asTrimmedString(sessionID);
  if (!id) return null;
  const runs = listAdapterRunsFromFiles(options);
  return runs.find((run) => run.sessionID === id) || null;
};
