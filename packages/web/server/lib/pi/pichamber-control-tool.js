import {
  OPENCHAMBER_AGENT_TOOL_ACTION_DEFINITIONS,
  OPENCHAMBER_AGENT_TOOL_ACTIONS,
} from '../openchamber-control/actions.js';

export const PICHAMBER_CONTROL_TOOL_NAME = 'pichamber';
const PICHAMBER_CONTROL_TOOL_LABEL = 'Pichamber';
const TOOL_SCHEMA_VERSION = 1;
const AGENT_ACTIONS = new Set(OPENCHAMBER_AGENT_TOOL_ACTIONS);

export const CONTROL_PARAMETER_NAMES = Object.freeze([
  'projectId',
  'directory',
  'sessionId',
  'messageId',
  'taskId',
  'title',
  'prompt',
  'model',
  'agent',
  'variant',
  'worktree',
  'branch',
  'startRef',
  'setUpstream',
  'goal',
  'goalTokenBudget',
  'wait',
  'timeout',
  'lastAssistant',
  'limit',
  'all',
  'last',
  'withStatus',
  'role',
  'name',
  'daily',
  'weekly',
  'once',
  'time',
  'cron',
  'timezone',
  'disabled',
]);

export const PICHAMBER_CONTROL_TOOL_DESCRIPTION = "Control Pichamber projects, sessions, and scheduled tasks on the user's behalf. Sessions and scheduled tasks you create are for the user to follow and interact with; never use this tool to delegate parts of your own current task. Use one action per call. Scope with projectId or directory; omit both to use the current session directory. Session dispatches return immediately by default and you receive no notification when a dispatched session finishes, so never promise to report back on it; the user follows it in Pichamber; a dispatched session needs no follow-up from you. If the user later asks how it went, use session.messages (add wait to block until it is idle, lastAssistant for just the final answer) — session.send always sends a NEW prompt and never just waits. Set wait only when the user asks or the next step requires the completed result. Session and worktree deletion are unavailable.";

const CONTROL_PARAMETER_PROPERTIES = Object.freeze({
  projectId: { type: 'string', description: 'Configured project ID; do not combine with directory' },
  directory: { type: 'string', description: 'Absolute checkout or session directory; defaults to the current session directory' },
  sessionId: { type: 'string' },
  messageId: { type: 'string', description: 'Optional fork boundary message ID' },
  taskId: { type: 'string' },
  title: { type: 'string' },
  prompt: { type: 'string' },
  model: { type: 'string', description: 'Model in provider/model format. When the user names no model: for session.create pick a suitable one from models.list favorites or recents (omit if there are none); for send and fork omit it — the session reuses its previous model' },
  agent: { type: 'string', description: 'Pi primary agent only. Omit by default. Unknown leftover OpenCode agent names are rejected' },
  variant: { type: 'string', description: 'Pi thinking level; use only when the user explicitly requests it' },
  worktree: { type: 'string', description: 'New worktree name for session.create. Omit by default; use only when the user explicitly asks for an isolated worktree. Uncommitted changes do not carry over into a new worktree' },
  branch: { type: 'string', description: 'Branch name for the new worktree' },
  startRef: { type: 'string', description: 'Git ref used to create the new worktree' },
  setUpstream: { type: 'boolean', description: 'Make the new worktree branch track its upstream' },
  goal: { type: 'boolean', description: 'Start Feature Plugins Goal with the prompt; use only when the user explicitly requests it' },
  goalTokenBudget: { type: 'integer', minimum: 1000, maximum: 100_000_000, description: 'Goal token budget; requires goal' },
  wait: { type: 'boolean', description: 'Wait for current session activity to become idle. Omit by default; use only when the user asks or the next step requires the completed result' },
  timeout: { type: 'integer', minimum: 1, maximum: 86_400, description: 'Wait timeout in seconds (default 600); requires wait' },
  lastAssistant: { type: 'boolean', description: 'Return the last assistant text; create/send/fork require wait' },
  limit: { type: 'integer', minimum: 1, description: 'Maximum sessions or messages to return (default 10)' },
  all: { type: 'boolean', description: 'Include archived sessions or all messages, depending on the action' },
  last: { type: 'boolean', description: 'Return only the last matching session message' },
  withStatus: { type: 'boolean', description: 'Include authoritative status in session.list' },
  role: { type: 'string', enum: ['all', 'user', 'assistant'], description: 'Message role filter' },
  name: { type: 'string' },
  daily: { type: 'string', description: 'Daily run time in HH:mm format' },
  weekly: { type: 'string', description: 'Comma-separated weekdays; 0=Sunday and 6=Saturday' },
  once: { type: 'string', description: 'One-time run date in YYYY-MM-DD format' },
  time: { type: 'string', description: 'Weekly or one-time run time in HH:mm format' },
  cron: { type: 'string', description: 'Cron expression' },
  timezone: { type: 'string', description: 'IANA timezone' },
  disabled: { type: 'boolean', description: 'true disables and false enables; required for schedule.toggle' },
});

const createResult = ({ ok, action, data, error }) => ({
  schemaVersion: TOOL_SCHEMA_VERSION,
  ok,
  action: action || 'unknown',
  ...(data !== undefined ? { data } : {}),
  ...(error ? { error } : {}),
});

const asObject = (value) => (
  value && typeof value === 'object' && !Array.isArray(value) ? value : null
);

/**
 * Models put inputs next to `action` or inside `parameters`. Both shapes are
 * accepted; an explicit `parameters` object wins on a conflict.
 */
export const preparePichamberControlArguments = (args) => {
  const input = asObject(args) || {};
  const { action, parameters, ...flattened } = input;
  return {
    ...flattened,
    ...(asObject(parameters) || {}),
    action,
  };
};

const usageResult = (action, message) => ({
  content: [{
    type: 'text',
    text: JSON.stringify(createResult({
      ok: false,
      action,
      error: { message, kind: 'usage' },
    })),
  }],
});

/**
 * Host-owned Pi `defineTool` for sessions, worktrees, and scheduled tasks.
 *
 * `defineTool` from the Pi SDK is an identity helper for TypeScript inference.
 * This module is JS, so the returned object is the ToolDefinition the session
 * receives as `customTools`.
 */
export const createPichamberControlTool = ({ executeAction } = {}) => ({
  name: PICHAMBER_CONTROL_TOOL_NAME,
  label: PICHAMBER_CONTROL_TOOL_LABEL,
  description: PICHAMBER_CONTROL_TOOL_DESCRIPTION,
  promptSnippet: "Control Pichamber projects, sessions, and scheduled tasks on the user's behalf.",
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: [...OPENCHAMBER_AGENT_TOOL_ACTIONS],
        oneOf: OPENCHAMBER_AGENT_TOOL_ACTION_DEFINITIONS.map((entry) => ({
          const: entry.action,
          description: entry.description,
        })),
        description: 'Pichamber action to perform',
      },
      ...CONTROL_PARAMETER_PROPERTIES,
      parameters: {
        type: 'object',
        properties: CONTROL_PARAMETER_PROPERTIES,
        additionalProperties: false,
        description: 'Inputs for the action; use an empty object when none are needed',
      },
    },
    required: ['action'],
    additionalProperties: false,
  },
  prepareArguments: preparePichamberControlArguments,
  async execute(_toolCallId, params, signal, _onUpdate, ctx) {
    const action = typeof params?.action === 'string' ? params.action : '';
    try {
      if (!AGENT_ACTIONS.has(action)) {
        return usageResult(action, `Unsupported Pichamber action: ${action || 'missing'}`);
      }
      if (typeof executeAction !== 'function') {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify(createResult({
              ok: false,
              action,
              error: { message: 'Pichamber control service is unavailable', kind: 'runtime' },
            })),
          }],
        };
      }
      const data = await executeAction(action, params, ctx?.cwd, { signal });
      return {
        content: [{
          type: 'text',
          text: JSON.stringify(createResult({ ok: true, action, data })),
        }],
      };
    } catch (error) {
      if (signal?.aborted) throw error;
      const status = Number(error?.statusCode);
      return {
        content: [{
          type: 'text',
          text: JSON.stringify(createResult({
            ok: false,
            action,
            error: {
              message: error instanceof Error ? error.message : String(error),
              kind: status >= 400 && status < 499 ? 'usage' : 'runtime',
            },
          })),
        }],
      };
    }
  },
});
