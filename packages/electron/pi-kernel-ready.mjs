export const buildHealthUrl = (url) => {
  try {
    const parsed = new URL(url);
    parsed.pathname = `${parsed.pathname.replace(/\/$/, '') || ''}/health`;
    return parsed.toString();
  } catch {
    return null;
  }
};

export const isPiKernelHealthReady = (data) => (
  data?.kernelReady === true || data?.piRunning === true
);

export const resolveLocalBootStatus = ({ localAvailable, localKernelReady }) => (
  localAvailable && localKernelReady ? 'ok' : 'unreachable'
);

export const waitForPiKernelReady = async (url, options = {}) => {
  const {
    timeoutMs = 20_000,
    initialPollMs = 250,
    maxPollMs = 2000,
    fetchImpl = fetch,
    now = Date.now,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  } = options;
  const healthUrl = buildHealthUrl(url);
  if (!healthUrl) return false;

  const deadline = now() + timeoutMs;
  let pollMs = initialPollMs;
  while (now() < deadline) {
    try {
      const response = await fetchImpl(healthUrl, {
        signal: AbortSignal.timeout(Math.min(pollMs * 4, 1500)),
      });
      const data = await response.json().catch(() => null);
      if (isPiKernelHealthReady(data)) return true;
      // A still-starting Node child can report PI_SDK_UNAVAILABLE, PI_NODE_UNAVAILABLE,
      // or piNodeRuntime.ok === false. Those are not a hard boot failure.
    } catch {
      // Unreachable, abort, or non-JSON — keep polling until the deadline.
    }
    const remaining = deadline - now();
    if (remaining <= 0) break;
    await sleep(Math.min(pollMs, remaining));
    pollMs = Math.min(pollMs * 2, maxPollMs);
  }
  return false;
};
