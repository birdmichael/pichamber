import {
  OPENCHAMBER_WEB_ACTION_DEFINITIONS,
  OPENCHAMBER_WEB_ACTIONS,
} from '../openchamber-control/actions.js';

export const PICHAMBER_WEB_TOOL_NAME = 'pichamber_web';
export const PICHAMBER_WEB_TOOL_LABEL = 'Pichamber Web';
export const WEB_PARAMETER_NAMES = Object.freeze([
  'url',
  'selector',
  'text',
  'value',
  'submit',
  'direction',
  'viewport',
  'label',
]);

const TOOL_SCHEMA_VERSION = 1;

export const PICHAMBER_WEB_TOOL_DESCRIPTION = "Look at and interact with a web page in Pichamber's browser panel, so you can check your own work rather than describing what you expect. Use one action per call. Open a page, snapshot it to read its text and its interactive elements, then click, type or scroll using the selectors the snapshot returned; snapshots also report any errors the page logged. Pass a selector to browser.snapshot to read one part of a long page. browser.inspect returns computed styles when the question is how something renders. Set viewport to check a layout at mobile, tablet or desktop size. The page runs with the user's real logins, so treat what you see as their live session.";

const WEB_PARAMETER_PROPERTIES = Object.freeze({
  url: { type: 'string', description: 'http(s) URL for browser.open' },
  selector: { type: 'string', description: 'CSS selector from a browser.snapshot result' },
  text: { type: 'string', description: 'Visible label to match when no selector is given' },
  value: { type: 'string', description: 'Text to type for browser.type' },
  submit: { type: 'boolean', description: 'Press Enter after typing' },
  direction: { type: 'string', enum: ['up', 'down', 'top', 'bottom'], description: 'Scroll direction for browser.scroll' },
  viewport: { type: 'string', enum: ['mobile', 'tablet', 'desktop', 'fill'], description: 'Page layout size; snapshots report which one is in effect' },
  label: { type: 'string', description: 'Short name for a browser.capture image, such as before-fix' },
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
export const preparePichamberWebArguments = (args) => {
  const input = asObject(args) || {};
  const { action, parameters, ...flattened } = input;
  return {
    ...flattened,
    ...(asObject(parameters) || {}),
    action,
  };
};

/**
 * Host-owned Pi `defineTool` for the Desktop browser rail.
 *
 * `defineTool` from the Pi SDK is an identity helper for TypeScript inference.
 * This module is JS, so the returned object is the ToolDefinition the session
 * receives as `customTools`.
 */
export const createPichamberWebTool = ({ executeAction } = {}) => ({
  name: PICHAMBER_WEB_TOOL_NAME,
  label: PICHAMBER_WEB_TOOL_LABEL,
  description: PICHAMBER_WEB_TOOL_DESCRIPTION,
  promptSnippet: "Look at and interact with the page in Pichamber's browser panel.",
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: [...OPENCHAMBER_WEB_ACTIONS],
        oneOf: OPENCHAMBER_WEB_ACTION_DEFINITIONS.map((entry) => ({
          const: entry.action,
          description: entry.description,
        })),
        description: 'Browser action to perform',
      },
      ...WEB_PARAMETER_PROPERTIES,
      parameters: {
        type: 'object',
        properties: WEB_PARAMETER_PROPERTIES,
        additionalProperties: false,
        description: 'Inputs for the action; use an empty object when none are needed',
      },
    },
    required: ['action'],
    additionalProperties: false,
  },
  prepareArguments: preparePichamberWebArguments,
  async execute(_toolCallId, params, signal, _onUpdate, ctx) {
    const action = typeof params?.action === 'string' ? params.action : '';
    try {
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
