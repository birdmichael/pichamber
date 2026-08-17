import { describe, expect, it } from 'vitest';

import { createPichamberControlTool } from './pichamber-control-tool.js';
import { createPichamberWebTool } from './pichamber-web-tool.js';
import { createInMemoryPiSession, createPiHost } from './pi-host.js';

const webTool = createPichamberWebTool({
  executeAction: async () => ({ ok: true }),
});
const controlTool = createPichamberControlTool({
  executeAction: async () => ({ ok: true }),
});

const toolsFor = ({ control = false, web = false } = {}) => {
  const tools = [];
  if (control) tools.push(controlTool);
  if (web) tools.push(webTool);
  return tools.length > 0 ? tools : undefined;
};

describe('Pi host pichamber_web custom tools', () => {
  it('attaches pichamber_web when the web tool is enabled', async () => {
    const host = createPiHost({
      mock: true,
      getCustomTools: async () => [webTool],
      createSession: async ({ customTools } = {}) => createInMemoryPiSession({ customTools }),
    });
    const record = await host.createSession({ directory: '/tmp/project' });
    expect(record.piSession.getToolDefinition('pichamber_web')).toEqual(expect.objectContaining({
      name: 'pichamber_web',
      label: 'Pichamber Web',
    }));
    expect(record.piSession.getToolDefinition('openchamber_web')).toBeUndefined();
    host.dispose();
  });

  it('omits pichamber_web when the web tool is disabled', async () => {
    const host = createPiHost({
      mock: true,
      getCustomTools: async () => undefined,
      createSession: async ({ customTools } = {}) => createInMemoryPiSession({ customTools }),
    });
    const record = await host.createSession({ directory: '/tmp/project' });
    expect(record.piSession.getToolDefinition('pichamber_web')).toBeUndefined();
    expect(record.piSession.getToolDefinition('pichamber')).toBeUndefined();
    host.dispose();
  });

  it('omits both pichamber tools when every host tool is off', async () => {
    const host = createPiHost({
      mock: true,
      getCustomTools: async () => [],
      createSession: async ({ customTools } = {}) => createInMemoryPiSession({ customTools }),
    });
    const record = await host.createSession({ directory: '/tmp/project' });
    expect(record.piSession.getToolDefinition('pichamber')).toBeUndefined();
    expect(record.piSession.getToolDefinition('pichamber_web')).toBeUndefined();
    host.dispose();
  });

  it('drops the web tool from idle sessions after reload and leaves a busy sibling alone', async () => {
    let enabled = true;
    const idleSession = createInMemoryPiSession();
    const busySession = createInMemoryPiSession({ compacting: true });
    const created = [];
    const host = createPiHost({
      mock: true,
      getCustomTools: async () => (enabled ? [webTool] : undefined),
      createSession: async ({ customTools } = {}) => {
        const next = created.length === 0 ? idleSession : busySession;
        created.push(next);
        next.setCustomTools(customTools);
        return next;
      },
    });
    const idle = await host.createSession({ directory: '/tmp/project', title: 'Idle' });
    const busy = await host.createSession({ directory: '/tmp/project', title: 'Busy' });
    expect(idleSession.getToolDefinition('pichamber_web')?.name).toBe('pichamber_web');
    expect(busySession.getToolDefinition('pichamber_web')?.name).toBe('pichamber_web');

    enabled = false;
    const result = await host.reloadIdleSessions();
    expect(result.reloaded).toEqual([idle.id]);
    expect(result.skipped).toHaveLength(1);
    expect(idleSession.getToolDefinition('pichamber_web')).toBeUndefined();
    expect(busySession.getToolDefinition('pichamber_web')?.name).toBe('pichamber_web');
    await expect(host.reload({ sessionID: busy.id })).rejects.toMatchObject({ status: 409 });
    expect(busySession.getToolDefinition('pichamber_web')?.name).toBe('pichamber_web');
    host.dispose();
  });

  it('passes customTools to both session factories', async () => {
    const sessionArgs = [];
    const directoryArgs = [];
    const host = createPiHost({
      mock: true,
      getCustomTools: async () => [webTool],
      createSession: async (args) => {
        sessionArgs.push(args);
        return createInMemoryPiSession({ customTools: args.customTools });
      },
      createDirectoryRuntime: async (args) => {
        directoryArgs.push(args);
        return { session: null, directory: args.cwd };
      },
    });
    await host.createSession({ directory: '/tmp/project' });
    await host.ready();
    expect(sessionArgs[0].customTools.map((tool) => tool.name)).toEqual(['pichamber_web']);
    expect(directoryArgs[0].customTools.map((tool) => tool.name)).toEqual(['pichamber_web']);
    host.dispose();
  });

  it('attaches pichamber independently of pichamber_web', async () => {
    const cases = [
      { control: true, web: false, expectControl: true, expectWeb: false },
      { control: false, web: true, expectControl: false, expectWeb: true },
      { control: true, web: true, expectControl: true, expectWeb: true },
      { control: false, web: false, expectControl: false, expectWeb: false },
    ];
    for (const entry of cases) {
      const host = createPiHost({
        mock: true,
        getCustomTools: async () => toolsFor(entry),
        createSession: async ({ customTools } = {}) => createInMemoryPiSession({ customTools }),
      });
      const record = await host.createSession({ directory: '/tmp/project' });
      const control = record.piSession.getToolDefinition('pichamber');
      const web = record.piSession.getToolDefinition('pichamber_web');
      if (entry.expectControl) {
        expect(control).toEqual(expect.objectContaining({ name: 'pichamber', label: 'Pichamber' }));
        expect(record.piSession.getToolDefinition('openchamber')).toBeUndefined();
      } else {
        expect(control).toBeUndefined();
      }
      if (entry.expectWeb) {
        expect(web?.name).toBe('pichamber_web');
      } else {
        expect(web).toBeUndefined();
      }
      host.dispose();
    }
  });

  it('drops the control tool from idle sessions after reload', async () => {
    let enabled = true;
    const idleSession = createInMemoryPiSession();
    const busySession = createInMemoryPiSession({ compacting: true });
    const created = [];
    const host = createPiHost({
      mock: true,
      getCustomTools: async () => toolsFor({ control: enabled, web: true }),
      createSession: async ({ customTools } = {}) => {
        const next = created.length === 0 ? idleSession : busySession;
        created.push(next);
        next.setCustomTools(customTools);
        return next;
      },
    });
    const idle = await host.createSession({ directory: '/tmp/project', title: 'Idle' });
    await host.createSession({ directory: '/tmp/project', title: 'Busy' });
    expect(idleSession.getToolDefinition('pichamber')?.name).toBe('pichamber');
    expect(idleSession.getToolDefinition('pichamber_web')?.name).toBe('pichamber_web');

    enabled = false;
    const result = await host.reloadIdleSessions();
    expect(result.reloaded).toEqual([idle.id]);
    expect(idleSession.getToolDefinition('pichamber')).toBeUndefined();
    expect(idleSession.getToolDefinition('pichamber_web')?.name).toBe('pichamber_web');
    expect(busySession.getToolDefinition('pichamber')?.name).toBe('pichamber');
    host.dispose();
  });

  it('does not attach a web tool on the mock kernel unless a test injects one', async () => {
    const host = createPiHost({
      mock: true,
      createSession: async () => createInMemoryPiSession(),
    });
    const record = await host.createSession({ directory: '/tmp/project' });
    expect(record.piSession.getToolDefinition('pichamber_web')).toBeUndefined();
    host.dispose();
  });
});
