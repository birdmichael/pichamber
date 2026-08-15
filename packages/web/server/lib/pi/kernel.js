export const PI_KERNEL = 'pi';
export const OPENCODE_KERNEL = 'opencode';

export const resolveKernelName = (env = process.env) => {
  const raw = typeof env.OPENCHAMBER_KERNEL === 'string' ? env.OPENCHAMBER_KERNEL.trim().toLowerCase() : '';
  if (raw === OPENCODE_KERNEL) return OPENCODE_KERNEL;
  if (raw === PI_KERNEL || raw === '' || raw === 'pichamber') return PI_KERNEL;
  return PI_KERNEL;
};

export const isPiKernelEnabled = (env = process.env) => resolveKernelName(env) === PI_KERNEL;

export const isPiMockEnabled = (env = process.env) => {
  if (env.OPENCHAMBER_PI_MOCK === '1' || env.OPENCHAMBER_PI_MOCK === 'true') return true;
  return false;
};
