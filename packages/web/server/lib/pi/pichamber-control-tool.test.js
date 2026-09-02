import { describe, expect, it, vi } from 'vitest';

import { OPENCHAMBER_AGENT_TOOL_ACTIONS } from '../openchamber-control/actions.js';
import { OpenChamberControlError } from '../openchamber-control/error.js';
import {
  CONTROL_PARAMETER_NAMES,
  PICHAMBER_CONTROL_TOOL_DESCRIPTION,
  PICHAMBER_CONTROL_TOOL_NAME,
  createPichamberControlTool,
  preparePichamberControlArguments,
} from './pichamber-control-tool.js';

describe('pichamber control tool', () => {
  it('exposes the Pichamber schema and only the 13 agent-exposed actions', () => {
    const tool = createPichamberControlTool();
    expect(tool.name).toBe(PICHAMBER_CONTROL_TOOL_NAME);
    expect(tool.name).toBe('pichamber');
    expect(tool.label).toBe('Pichamber');
    expect(tool.parameters.properties.action.enum).toEqual([...OPENCHAMBER_AGENT_TOOL_ACTIONS]);
    expect(tool.parameters.properties.action.enum).toEqual([
      'projects.list',
      'models.list',
      'session.list',
      'session.create',
      'session.send',
      'session.fork',
      'session.status',
      'session.messages',
      'schedule.list',
      'schedule.create',
      'schedule.run',
      'schedule.delete',
      'schedule.toggle',
    ]);
    expect(tool.parameters.properties.action.enum).not.toContain('schedule.status');
    expect(tool.parameters.properties.action.enum).not.toContain('session.delete');
    expect(tool.parameters.properties.action.enum.some((action) => action.startsWith('browser.'))).toBe(false);
    for (const name of ['sessionId', 'projectId', 'directory', 'prompt', 'model', 'wait', 'worktree', 'disabled']) {
      expect(tool.parameters.properties).toHaveProperty(name);
    }
    expect(tool.parameters.properties).not.toHaveProperty('url');
    expect(tool.parameters.properties).not.toHaveProperty('selector');
    for (const name of CONTROL_PARAMETER_NAMES) {
      expect(tool.parameters.properties).toHaveProperty(name);
    }
  });


  it('does not duplicate parameter properties under nested parameters (#468)', () => {
    const tool = createPichamberControlTool();
    const nested = tool.parameters.properties.parameters;
    expect(nested).toEqual(expect.objectContaining({
      type: 'object',
      additionalProperties: true,
    }));
    expect(nested.properties).toBeUndefined();
    // Flat fields stay discoverable once; nesting them again roughly doubled tokens.
    for (const name of CONTROL_PARAMETER_NAMES) {
      expect(tool.parameters.properties).toHaveProperty(name);
    }
    const serialized = JSON.stringify({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    });
    // Before #468 this was ~9.2k chars / ~2.3k tokens from schema duplication alone.
    expect(serialized.length).toBeLessThan(7000);
  });

  it('keeps flattened arguments after prepareArguments', () => {
    expect(preparePichamberControlArguments({
      action: 'session.create',
      directory: '/repo',
      prompt: 'say hi',
    })).toEqual({
      action: 'session.create',
      directory: '/repo',
      prompt: 'say hi',
    });
  });

  it('lets an explicit parameters object win over flattened fields', () => {
    expect(preparePichamberControlArguments({
      action: 'session.send',
      sessionId: 'ses_flat',
      prompt: 'ignored',
      parameters: { sessionId: 'ses_nested', prompt: 'Continue' },
    })).toEqual({
      action: 'session.send',
      sessionId: 'ses_nested',
      prompt: 'Continue',
    });
  });

  it('describes Pichamber orchestration without saying OpenChamber', () => {
    const tool = createPichamberControlTool();
    expect(tool.description).toBe(PICHAMBER_CONTROL_TOOL_DESCRIPTION);
    expect(tool.description).not.toContain('OpenChamber');
    expect(tool.description).toContain('never use this tool to delegate parts of your own current task');
    expect(tool.description).toContain('Set wait only when the user asks');
    expect(tool.promptSnippet).toContain('Pichamber');
  });

  it('delegates execute to executeAction and returns a JSON envelope', async () => {
    const executeAction = vi.fn(async () => ({ sessionId: 'ses_1' }));
    const tool = createPichamberControlTool({ executeAction });
    const signal = new AbortController().signal;
    const params = tool.prepareArguments({
      action: 'session.create',
      directory: '/work/project',
      title: 'from-tool',
    });
    const result = await tool.execute('call_1', params, signal, undefined, { cwd: '/work/project' });
    expect(executeAction).toHaveBeenCalledWith('session.create', params, '/work/project', { signal });
    expect(JSON.parse(result.content[0].text)).toEqual({
      schemaVersion: 1,
      ok: true,
      action: 'session.create',
      data: { sessionId: 'ses_1' },
    });
  });

  it('rejects session.delete and schedule.status before executeAction', async () => {
    const executeAction = vi.fn(async () => ({}));
    const tool = createPichamberControlTool({ executeAction });
    for (const action of ['session.delete', 'schedule.status']) {
      const result = await tool.execute('call_1', { action }, undefined, undefined, { cwd: '/tmp' });
      expect(JSON.parse(result.content[0].text)).toEqual({
        schemaVersion: 1,
        ok: false,
        action,
        error: { message: `Unsupported Pichamber action: ${action}`, kind: 'usage' },
      });
    }
    expect(executeAction).not.toHaveBeenCalled();
  });

  it('maps a 400 service throw to a usage envelope without throwing', async () => {
    const tool = createPichamberControlTool({
      executeAction: async () => {
        throw new OpenChamberControlError('timeout requires wait', 400);
      },
    });
    const result = await tool.execute(
      'call_1',
      { action: 'session.create', timeout: 30 },
      undefined,
      undefined,
      { cwd: '/work/project' },
    );
    expect(JSON.parse(result.content[0].text)).toEqual({
      schemaVersion: 1,
      ok: false,
      action: 'session.create',
      error: { message: 'timeout requires wait', kind: 'usage' },
    });
  });

  it('forwards AbortSignal into executeAction', async () => {
    const executeAction = vi.fn(async () => ({}));
    const tool = createPichamberControlTool({ executeAction });
    const controller = new AbortController();
    await tool.execute('call_1', { action: 'projects.list' }, controller.signal, undefined, { cwd: '/tmp' });
    expect(executeAction.mock.calls[0][3]).toEqual({ signal: controller.signal });
  });

  it('rethrows a cancelled wait instead of returning idle', async () => {
    const controller = new AbortController();
    const tool = createPichamberControlTool({
      executeAction: async (_action, _params, _cwd, { signal } = {}) => {
        controller.abort();
        if (signal?.aborted) {
          throw new OpenChamberControlError('OpenChamber action was cancelled', 499);
        }
        return { sessionStatus: { type: 'idle' } };
      },
    });
    await expect(tool.execute(
      'call_1',
      { action: 'session.messages', sessionId: 'ses_1', wait: true },
      controller.signal,
      undefined,
      { cwd: '/repo' },
    )).rejects.toMatchObject({ statusCode: 499 });
  });
});
