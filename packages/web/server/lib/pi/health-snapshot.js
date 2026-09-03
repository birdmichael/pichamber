import { OPENCODE_KERNEL, PI_KERNEL } from './kernel.js';

const isPiKernel = (kernel) => kernel === PI_KERNEL;

/** Leftover OpenCode binary resolver. Not how the Pi kernel boots. */
const OPENCODE_RESOLVER_EXTRA_KEYS = new Set([
  'opencodeBinaryResolved',
  'opencodeBinarySource',
  'opencodeLaunchBinary',
  'opencodeLaunchArgs',
  'opencodeLaunchWrapperType',
  'lastOpenCodeLaunchDiagnostics',
  'opencodeViaWsl',
  'opencodeWslBinary',
  'opencodeWslPath',
  'opencodeWslDistro',
]);

/** Pi CLI detection for chooser/local-setup. Desktop does not spawn PATH pi. */
const PI_RESOLVER_EXTRA_KEYS = new Set([
  'piBinaryResolved',
  'piBinarySource',
]);

const extrasForKernel = (extras, isPi) => {
  if (!extras || typeof extras !== 'object') return extras || {};
  const skip = isPi ? OPENCODE_RESOLVER_EXTRA_KEYS : PI_RESOLVER_EXTRA_KEYS;
  return Object.fromEntries(
    Object.entries(extras).filter(([key]) => !skip.has(key)),
  );
};

export const buildHealthSnapshot = ({
  kernel,
  piMock = false,
  piReady = false,
  openCodePort = null,
  isOpenCodeReady = false,
  isRestartingOpenCode = false,
  extras = {},
} = {}) => {
  const isPi = isPiKernel(kernel);
  const openCodeRunning = isPi
    ? false
    : Boolean(openCodePort && isOpenCodeReady && !isRestartingOpenCode);

  return {
    ...extrasForKernel(extras, isPi),
    kernel: isPi ? PI_KERNEL : OPENCODE_KERNEL,
    piMock: Boolean(piMock),
    openCodePort: isPi ? null : openCodePort,
    openCodeRunning,
    isOpenCodeReady: isPi ? false : Boolean(isOpenCodeReady),
    kernelReady: isPi ? Boolean(piReady) : openCodeRunning,
    piRunning: isPi ? Boolean(piReady) : false,
  };
};
