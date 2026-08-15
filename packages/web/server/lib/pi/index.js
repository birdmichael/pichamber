import { createPiHost, createInMemoryPiSession, mapPiModelsToProviders } from './pi-host.js';
import { registerPiFacade } from './opencode-facade.js';
import { createSseBus } from './sse-bus.js';
import { createEventTranslator } from './event-translator.js';
import { isPiKernelEnabled, isPiMockEnabled, resolveKernelName, PI_KERNEL, OPENCODE_KERNEL } from './kernel.js';

export const createPiKernel = (options = {}) => {
  const env = options.env || process.env;
  const mock = options.mock ?? isPiMockEnabled(env);
  const bus = options.bus || createSseBus();
  const host = options.host || createPiHost({
    ...options,
    mock,
    onEvent: (directory, event) => {
      bus.publish(directory, event, { eventId: event?.id });
      if (typeof options.onEvent === 'function') {
        options.onEvent(directory, event);
      }
    },
  });

  bus.start();

  return {
    kernel: PI_KERNEL,
    mock,
    host,
    bus,
    register(app) {
      registerPiFacade(app, {
        host,
        bus,
        defaultDirectory: options.defaultDirectory || process.cwd(),
      });
    },
    async ready() {
      await host.ready();
      return true;
    },
    dispose() {
      host.dispose();
      bus.stop();
    },
  };
};

export {
  createPiHost,
  createInMemoryPiSession,
  mapPiModelsToProviders,
  registerPiFacade,
  createSseBus,
  createEventTranslator,
  isPiKernelEnabled,
  isPiMockEnabled,
  resolveKernelName,
  PI_KERNEL,
  OPENCODE_KERNEL,
};
