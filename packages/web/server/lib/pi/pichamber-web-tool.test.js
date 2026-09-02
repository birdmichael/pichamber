import { describe, expect, it, vi } from 'vitest';

import { OPENCHAMBER_WEB_ACTIONS } from '../openchamber-control/actions.js';
import { OpenChamberControlError } from '../openchamber-control/error.js';
import {
  PICHAMBER_WEB_TOOL_DESCRIPTION,
  PICHAMBER_WEB_TOOL_NAME,
  WEB_PARAMETER_NAMES,
  createPichamberWebTool,
  preparePichamberWebArguments,
} from './pichamber-web-tool.js';

describe('pichamber_web tool', () => {
  it('exposes the Pichamber web schema and only the ten browser actions', () => {
    const tool = createPichamberWebTool();
    expect(tool.name).toBe(PICHAMBER_WEB_TOOL_NAME);
    expect(tool.name).toBe('pichamber_web');
    expect(tool.label).toBe('Pichamber Web');
    expect(tool.parameters.properties.action.enum).toEqual([...OPENCHAMBER_WEB_ACTIONS]);
    expect(tool.parameters.properties.action.enum).toEqual([
      'browser.open',
      'browser.snapshot',
      'browser.click',
      'browser.type',
      'browser.scroll',
      'browser.back',
      'browser.forward',
      'browser.inspect',
      'browser.capture',
      'browser.resize',
    ]);
    expect(tool.parameters.properties.action.enum.some((action) => action.startsWith('session.'))).toBe(false);
    expect(tool.parameters.properties.action.enum.some((action) => action.startsWith('schedule.'))).toBe(false);
    for (const name of WEB_PARAMETER_NAMES) {
      expect(tool.parameters.properties).toHaveProperty(name);
    }
    expect(tool.parameters.properties).not.toHaveProperty('sessionId');
  });


  it('does not duplicate parameter properties under nested parameters (#468)', () => {
    const tool = createPichamberWebTool();
    const nested = tool.parameters.properties.parameters;
    expect(nested).toEqual(expect.objectContaining({
      type: 'object',
      additionalProperties: true,
    }));
    expect(nested.properties).toBeUndefined();
    for (const name of WEB_PARAMETER_NAMES) {
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
    // Before #468 this was ~4.4k chars from schema duplication alone.
    expect(serialized.length).toBeLessThan(4000);
  });

  it('keeps flattened arguments after prepareArguments', () => {
    expect(preparePichamberWebArguments({
      action: 'browser.open',
      url: 'https://example.test',
      viewport: 'mobile',
    })).toEqual({
      action: 'browser.open',
      url: 'https://example.test',
      viewport: 'mobile',
    });
  });

  it('lets an explicit parameters object win over flattened fields', () => {
    expect(preparePichamberWebArguments({
      action: 'browser.open',
      url: 'https://ignored.test',
      parameters: { url: 'https://example.test/nested' },
    })).toEqual({
      action: 'browser.open',
      url: 'https://example.test/nested',
    });
  });

  it('delegates execute to executeAction and returns a JSON envelope', async () => {
    const executeAction = vi.fn(async () => ({ url: 'https://example.test' }));
    const tool = createPichamberWebTool({ executeAction });
    const signal = new AbortController().signal;
    const params = tool.prepareArguments({
      action: 'browser.open',
      url: 'https://example.test',
      viewport: 'mobile',
    });
    const result = await tool.execute('call_1', params, signal, undefined, { cwd: '/work/project' });
    expect(executeAction).toHaveBeenCalledWith('browser.open', params, '/work/project', { signal });
    expect(result.content[0].type).toBe('text');
    expect(JSON.parse(result.content[0].text)).toEqual({
      schemaVersion: 1,
      ok: true,
      action: 'browser.open',
      data: { url: 'https://example.test' },
    });
  });

  it('maps a 400 service throw to a usage envelope without throwing', async () => {
    const tool = createPichamberWebTool({
      executeAction: async () => {
        throw new OpenChamberControlError('url is required for browser.open', 400);
      },
    });
    const result = await tool.execute(
      'call_1',
      { action: 'browser.open' },
      undefined,
      undefined,
      { cwd: '/work/project' },
    );
    expect(JSON.parse(result.content[0].text)).toEqual({
      schemaVersion: 1,
      ok: false,
      action: 'browser.open',
      error: { message: 'url is required for browser.open', kind: 'usage' },
    });
  });

  it('forwards AbortSignal into executeAction', async () => {
    const executeAction = vi.fn(async () => ({}));
    const tool = createPichamberWebTool({ executeAction });
    const controller = new AbortController();
    await tool.execute('call_1', { action: 'browser.snapshot' }, controller.signal, undefined, { cwd: '/tmp' });
    expect(executeAction.mock.calls[0][3]).toEqual({ signal: controller.signal });
  });

  it('describes the Pichamber browser panel without saying OpenChamber', () => {
    const tool = createPichamberWebTool();
    expect(tool.description).toBe(PICHAMBER_WEB_TOOL_DESCRIPTION);
    expect(tool.description).not.toContain('OpenChamber');
    expect(tool.description).toContain("Pichamber's browser panel");
    expect(tool.promptSnippet).toContain("Pichamber's browser panel");
  });
});
