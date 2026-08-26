type KernelHealthSnapshot = {
  kernel?: unknown;
  status?: unknown;
  kernelReady?: unknown;
  piRunning?: unknown;
  openCodeRunning?: unknown;
  isOpenCodeReady?: unknown;
  lastOpenCodeError?: unknown;
  piNodeRuntime?: unknown;
};

const asText = (value: unknown): string => (
  typeof value === 'string' && value.trim() ? value.trim() : ''
);

const describePiNodeRuntimeFailure = (runtime: unknown): string => {
  if (!runtime || typeof runtime !== 'object') return '';
  const payload = runtime as {
    ok?: unknown;
    message?: unknown;
    recovery?: unknown;
    hello?: { sdk?: { error?: unknown } };
  };
  const sdkError = asText(payload.hello?.sdk?.error);
  const message = asText(payload.message) || sdkError;
  const recovery = asText(payload.recovery);
  return [message, recovery].filter(Boolean).join(' ');
};

export const isLocalKernelReady = (
  health: KernelHealthSnapshot | null | undefined,
): boolean => {
  if (!health || typeof health !== 'object') return false;
  if (health.kernelReady === true || health.piRunning === true) return true;
  if (health.kernel === 'pi' && health.status === 'ok') return true;
  return health.openCodeRunning === true || health.isOpenCodeReady === true;
};

export const resolveKernelDownMessage = (
  health: KernelHealthSnapshot | null | undefined,
  fallback: string,
): string => {
  if (!health || typeof health !== 'object') return fallback;
  const lastOpenCodeError = asText(health.lastOpenCodeError);
  if (lastOpenCodeError) return lastOpenCodeError;
  const runtimeFailure = describePiNodeRuntimeFailure(health.piNodeRuntime);
  if (runtimeFailure) return runtimeFailure;
  if (health.kernel === 'pi') {
    return fallback || 'Pi kernel is not running';
  }
  return fallback;
};
