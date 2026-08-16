import { OPENCODE_KERNEL, PI_KERNEL } from './kernel.js';

const isPiKernel = (kernel) => kernel === PI_KERNEL;

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
    ...extras,
    kernel: isPi ? PI_KERNEL : OPENCODE_KERNEL,
    piMock: Boolean(piMock),
    openCodePort: isPi ? null : openCodePort,
    openCodeRunning,
    isOpenCodeReady: isPi ? false : Boolean(isOpenCodeReady),
    kernelReady: isPi ? Boolean(piReady) : openCodeRunning,
    piRunning: isPi ? Boolean(piReady) : false,
  };
};
