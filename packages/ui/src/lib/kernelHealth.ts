type KernelHealthSnapshot = {
  kernel?: unknown;
  status?: unknown;
  kernelReady?: unknown;
  piRunning?: unknown;
  openCodeRunning?: unknown;
  isOpenCodeReady?: unknown;
  lastOpenCodeError?: unknown;
};

export const isLocalKernelReady = (
  health: KernelHealthSnapshot | null | undefined,
): boolean => {
  if (!health || typeof health !== 'object') return false;
  if (health.kernelReady === true || health.piRunning === true) return true;
  if (health.kernel === 'pi' && health.status === 'ok') return true;
  return health.openCodeRunning === true || health.isOpenCodeReady === true;
};
