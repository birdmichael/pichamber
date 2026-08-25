import { createPiHost, createInMemoryPiSession, mapPiModelsToProviders } from './pi-host.js';
import { registerPiFacade } from './opencode-facade.js';
import { createSseBus } from './sse-bus.js';
import { createEventTranslator } from './event-translator.js';
import { isPiKernelEnabled, isPiMockEnabled, resolveKernelName, PI_KERNEL, OPENCODE_KERNEL } from './kernel.js';
import { buildHealthSnapshot } from './health-snapshot.js';
import { createNodeKernelHost } from './node-kernel-client.js';
import { shouldUseNodeKernel } from './node-runtime.js';

const publishHostEvent = (bus, options) => (directory, event) => {
  bus.publish(directory, event, { eventId: event?.id });
  if (typeof options.onEvent === 'function') {
    options.onEvent(directory, event);
  }
};

export const createPiKernel = (options = {}) => {
  const env = options.env || process.env;
  const mock = options.mock ?? isPiMockEnabled(env);
  const versions = options.versions
    || (typeof options.getProcessVersions === 'function' ? options.getProcessVersions() : process.versions);
  const bus = options.bus || createSseBus();
  const useNodeKernel = shouldUseNodeKernel({
    env,
    versions,
    mock,
    useNodeKernel: options.useNodeKernel,
  });
  const host = options.host || (useNodeKernel
    ? createNodeKernelHost({
      ...options,
      mock,
      env,
      versions,
      onEvent: publishHostEvent(bus, options),
    })
    : createPiHost({
      ...options,
      mock,
      onEvent: publishHostEvent(bus, options),
    }));

  bus.start();

  return {
    kernel: PI_KERNEL,
    mock,
    host,
    bus,
    sessionLoader: useNodeKernel ? 'node' : 'in-process',
    register(app) {
      registerPiFacade(app, {
        host,
        bus,
        defaultDirectory: options.defaultDirectory || process.cwd(),
      });
    },
    async ready() {
      const ok = await host.ready();
      return ok !== false;
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
  buildHealthSnapshot,
};

export { shouldUseNodeKernel, PI_NODE_UNAVAILABLE_CODE, PI_SDK_UNAVAILABLE_CODE } from './node-runtime.js';
export { createNodeKernelHost } from './node-kernel-client.js';
