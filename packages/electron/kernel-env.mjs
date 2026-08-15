export const DEFAULT_DESKTOP_KERNEL = 'pi';
export const OPENCODE_DESKTOP_KERNEL = 'opencode';

export const resolveDesktopKernelName = (env = process.env) => {
  const raw = typeof env?.OPENCHAMBER_KERNEL === 'string' ? env.OPENCHAMBER_KERNEL.trim().toLowerCase() : '';
  if (raw === OPENCODE_DESKTOP_KERNEL) return OPENCODE_DESKTOP_KERNEL;
  return DEFAULT_DESKTOP_KERNEL;
};

export const applyDesktopKernelEnv = (env = process.env) => {
  const kernel = resolveDesktopKernelName(env);
  env.OPENCHAMBER_KERNEL = kernel;
  return kernel;
};
