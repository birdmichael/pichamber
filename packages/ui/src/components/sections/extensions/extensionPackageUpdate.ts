export type ExtensionPackageItem = {
  name: string;
  path: string;
  scope: string;
  source: string;
  currentVersion?: string | null;
  latestVersion?: string | null;
  updateAvailable?: boolean;
  pinned?: boolean;
};

export const parseExtensionPackages = (data: unknown): ExtensionPackageItem[] => {
  if (data === null || typeof data !== 'object') return [];
  const packages = (data as { packages?: unknown }).packages;
  if (!Array.isArray(packages)) return [];
  return packages.flatMap((item) => {
    if (item === null || typeof item !== 'object') return [];
    const row = item as {
      name?: unknown;
      path?: unknown;
      scope?: unknown;
      source?: unknown;
      currentVersion?: unknown;
      latestVersion?: unknown;
      updateAvailable?: unknown;
      pinned?: unknown;
    };
    if (typeof row.name !== 'string' || !row.name.trim()) return [];
    return [{
      name: row.name.trim(),
      path: typeof row.path === 'string' ? row.path : '',
      scope: typeof row.scope === 'string' ? row.scope : '',
      source: typeof row.source === 'string' ? row.source : '',
      currentVersion: typeof row.currentVersion === 'string' && row.currentVersion.trim()
        ? row.currentVersion.trim()
        : null,
      latestVersion: typeof row.latestVersion === 'string' && row.latestVersion.trim()
        ? row.latestVersion.trim()
        : null,
      updateAvailable: row.updateAvailable === true,
      pinned: row.pinned === true,
    }];
  });
};

export const packageHasUpdate = (item: ExtensionPackageItem): boolean => (
  item.updateAvailable === true && Boolean(item.latestVersion)
);

export const packagesWithUpdates = (packages: ExtensionPackageItem[]): ExtensionPackageItem[] => (
  packages.filter(packageHasUpdate)
);

export const packageUninstallSource = (item: ExtensionPackageItem): string => (
  (item.path || item.source || '').trim()
);

export const packageDisplayName = (item: Pick<ExtensionPackageItem, 'name' | 'path'>): string => (
  item.name.trim() || item.path.trim()
);

export const isNpmExtensionPackage = (item: ExtensionPackageItem): boolean => (
  item.source === 'npm' || item.path.trim().startsWith('npm:')
);

export type PackageVersionState = 'update' | 'upToDate' | 'unknown' | 'none';

/** Distinguishes a known current latest from a failed/skipped latest lookup. */
export const packageVersionState = (item: ExtensionPackageItem): PackageVersionState => {
  if (packageHasUpdate(item)) return 'update';
  if (item.currentVersion && item.latestVersion) return 'upToDate';
  if (item.currentVersion && !item.latestVersion && isNpmExtensionPackage(item)) return 'unknown';
  return 'none';
};
