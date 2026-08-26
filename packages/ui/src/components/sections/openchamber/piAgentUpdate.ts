export type PiUpgradeStatus = {
  available?: boolean | null;
  currentVersion?: string | null;
  latestVersion?: string | null;
  upgradeSupported?: boolean;
  upgradeReason?: string | null;
};

export const parsePiUpgradeStatus = (data: unknown): PiUpgradeStatus | null => {
  if (data === null || typeof data !== 'object') return null;
  const payload = data as {
    currentVersion?: unknown;
    latestVersion?: unknown;
    available?: unknown;
    upgrade?: unknown;
  };
  const currentVersion = typeof payload.currentVersion === 'string' && payload.currentVersion.trim()
    ? payload.currentVersion.trim()
    : null;
  const latestVersion = typeof payload.latestVersion === 'string' && payload.latestVersion.trim()
    ? payload.latestVersion.trim()
    : null;
  const upgrade = payload.upgrade && typeof payload.upgrade === 'object'
    ? payload.upgrade as { supported?: unknown; reason?: unknown }
    : null;
  return {
    currentVersion,
    latestVersion,
    available: payload.available === true,
    upgradeSupported: upgrade?.supported === true,
    upgradeReason: typeof upgrade?.reason === 'string' && upgrade.reason.trim()
      ? upgrade.reason.trim()
      : null,
  };
};

export const shouldShowPiLatestVersion = (status: PiUpgradeStatus | null): boolean => {
  if (!status?.latestVersion) return false;
  if (!status.currentVersion) return true;
  return status.latestVersion !== status.currentVersion && status.available === true;
};

export const canUpdatePiFromStatus = (status: PiUpgradeStatus | null): boolean => (
  Boolean(
    status?.upgradeSupported === true
    && status.currentVersion
    && status.latestVersion
    && status.available === true
  )
);

export const isPiUpToDate = (status: PiUpgradeStatus | null): boolean => (
  Boolean(status?.currentVersion && status.latestVersion) && !canUpdatePiFromStatus(status)
);
