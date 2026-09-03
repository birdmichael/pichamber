export type KernelHealthSnapshot = {
  kernel?: unknown;
  status?: unknown;
  kernelReady?: unknown;
  piRunning?: unknown;
  openCodeRunning?: unknown;
  isOpenCodeReady?: unknown;
  lastOpenCodeError?: unknown;
  piBinaryResolved?: unknown;
  piBinarySource?: unknown;
};

export const isLocalKernelReady = (
  health: KernelHealthSnapshot | null | undefined,
): boolean => {
  if (!health || typeof health !== 'object') return false;
  if (health.kernelReady === true || health.piRunning === true) return true;
  // Pi `status: ok` only means the sidecar is listening, not that the kernel can chat.
  if (health.kernel === 'pi') return false;
  return health.openCodeRunning === true || health.isOpenCodeReady === true;
};
