import { describe, expect, it, vi } from 'vitest';

import { createStartupPipelineRuntime } from './startup-pipeline-runtime.js';

describe('startup pipeline runtime', () => {
  it('publishes the listening port before bootstrapping managed OpenCode', async () => {
    const order = [];
    const runtime = createStartupPipelineRuntime({
      createTerminalRuntime: () => ({}),
      createDictationRuntime: () => ({}),
      createMessageStreamWsRuntime: () => ({}),
      createServerStartupRuntime: () => ({
        resolveBindHost: () => '127.0.0.1',
        startListeningAndMaybeTunnel: async () => {
          order.push('listen');
          return { activePort: 3901 };
        },
        attachProcessHandlers: vi.fn(),
      }),
    });

    await runtime.run({
      app: {},
      setupProxy: vi.fn(),
      staticRoutesRuntime: { registerStaticRoutes: vi.fn() },
      apiOnly: false,
      tunnelRuntimeContext: {
        setActivePort: (port) => order.push(`port:${port}`),
      },
      scheduleOpenCodeApiDetection: () => order.push('detect'),
      bootstrapOpenCodeAtStartup: () => order.push('bootstrap'),
      process: {},
      crypto: {},
      server: {},
      attachSignals: false,
    });

    expect(order).toEqual(['listen', 'port:3901', 'detect', 'bootstrap']);
  });

  it('does not resolve run() until async kernel bootstrap settles', async () => {
    const order = [];
    let resolveBootstrap;
    const bootstrapDone = new Promise((resolve) => {
      resolveBootstrap = resolve;
    });
    const runtime = createStartupPipelineRuntime({
      createTerminalRuntime: () => ({}),
      createDictationRuntime: () => ({}),
      createMessageStreamWsRuntime: () => ({}),
      createServerStartupRuntime: () => ({
        resolveBindHost: () => '127.0.0.1',
        startListeningAndMaybeTunnel: async () => {
          order.push('listen');
          return { activePort: 3901 };
        },
        attachProcessHandlers: vi.fn(),
      }),
    });

    let runResolved = false;
    const runPromise = runtime.run({
      app: {},
      setupProxy: vi.fn(),
      staticRoutesRuntime: { registerStaticRoutes: vi.fn() },
      apiOnly: false,
      tunnelRuntimeContext: {
        setActivePort: () => {},
      },
      scheduleOpenCodeApiDetection: () => {},
      bootstrapOpenCodeAtStartup: () => {
        order.push('bootstrap-start');
        return bootstrapDone.then(() => {
          order.push('bootstrap-end');
        });
      },
      process: {},
      crypto: {},
      server: {},
      attachSignals: false,
    }).then((value) => {
      runResolved = true;
      return value;
    });

    await Promise.resolve();
    await Promise.resolve();
    expect(runResolved).toBe(false);
    expect(order).toEqual(['listen', 'bootstrap-start']);

    resolveBootstrap();
    await runPromise;
    expect(runResolved).toBe(true);
    expect(order).toEqual(['listen', 'bootstrap-start', 'bootstrap-end']);
  });
});
