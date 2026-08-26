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
export type SkippedUserExtension = {
  source: string;
  nodePath: string;
  tree: string;
  compilerAbi: string;
};

export const parseSkippedUserExtensions = (data: unknown): SkippedUserExtension[] => {
  if (data === null || typeof data !== 'object') return [];
  const skipped = (data as { skippedUserExtensions?: unknown }).skippedUserExtensions;
  if (!Array.isArray(skipped)) return [];
  return skipped.flatMap((item) => {
    if (item === null || typeof item !== 'object') return [];
    const row = item as {
      source?: unknown;
      nodePath?: unknown;
      tree?: unknown;
      compilerAbi?: unknown;
    };
    const source = typeof row.source === 'string' ? row.source.trim() : '';
    if (!source) return [];
    return [{
      source,
      nodePath: typeof row.nodePath === 'string' ? row.nodePath : '',
      tree: typeof row.tree === 'string' ? row.tree : '',
      compilerAbi: typeof row.compilerAbi === 'string' ? row.compilerAbi : '',
    }];
  });
};

export const parseElectronNativeTreeError = (data: unknown): string | null => {
  if (data === null || typeof data !== 'object') return null;
  const tree = (data as { electronNativeTree?: unknown }).electronNativeTree;
  if (!tree || typeof tree !== 'object') return null;
  const payload = tree as { ok?: unknown; error?: unknown; enabled?: unknown };
  if (payload.ok === false && typeof payload.error === 'string' && payload.error.trim()) {
    return payload.error.trim();
  }
  return null;
};

export const packageVersionState = (item: ExtensionPackageItem): PackageVersionState => {
  if (packageHasUpdate(item)) return 'update';
  if (item.currentVersion && item.latestVersion) return 'upToDate';
  if (item.currentVersion && !item.latestVersion && isNpmExtensionPackage(item)) return 'unknown';
  return 'none';
};
