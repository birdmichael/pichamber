/**
 * Resolve the Projects "Add project directory" path box into a list directory
 * and an optional leaf filter. `~` / `~/` must list the home folder even when
 * the client has not resolved $HOME yet — the server expands those paths.
 */

export function normalizeDirectoryExplorerQuery(query: string): string {
  const trimmed = query.trim();
  if (trimmed === '~') {
    return '~/';
  }
  return trimmed;
}

export function expandTildeDirectoryPath(value: string, homeDirectory: string): string {
  const trimmed = value.trim();
  if (!homeDirectory) {
    return trimmed === '~' ? '~/' : trimmed;
  }
  if (trimmed === '~') {
    return homeDirectory;
  }
  if (trimmed.startsWith('~/')) {
    const suffix = trimmed.slice(2);
    if (!suffix) {
      return homeDirectory;
    }
    const home = homeDirectory.replace(/[/\\]+$/, '');
    return `${home}/${suffix}`;
  }
  return trimmed;
}

export function resolveDirectoryExplorerQuery(
  query: string,
  homeDirectory: string,
): { directory: string; filter: string } {
  const normalized = normalizeDirectoryExplorerQuery(query);
  if (!normalized) {
    if (homeDirectory) {
      return { directory: homeDirectory, filter: '' };
    }
    return { directory: '~/', filter: '' };
  }

  if (normalized === '~/' || normalized.startsWith('~/')) {
    const after = normalized === '~/' ? '' : normalized.slice(2);
    const lastSlash = after.lastIndexOf('/');
    let relativeDirectory = '';
    let filter = '';
    if (after) {
      if (lastSlash === -1) {
        filter = after;
      } else {
        relativeDirectory = after.slice(0, lastSlash);
        filter = after.slice(lastSlash + 1);
      }
    }
    const tildeDirectory = relativeDirectory
      ? `~/${relativeDirectory}${filter ? '' : '/'}`
      : '~/';
    return {
      directory: expandTildeDirectoryPath(tildeDirectory, homeDirectory),
      filter,
    };
  }

  const hasTrailingSlash = normalized.endsWith('/');
  const lastSlash = normalized.lastIndexOf('/');
  if (hasTrailingSlash) {
    return { directory: normalized, filter: '' };
  }
  if (lastSlash < 0) {
    return { directory: normalized, filter: '' };
  }
  if (lastSlash === 0) {
    return { directory: '/', filter: normalized.slice(1) };
  }
  return {
    directory: normalized.slice(0, lastSlash + 1),
    filter: normalized.slice(lastSlash + 1),
  };
}

export function shouldFetchDirectoryExplorerListing(
  directory: string,
  homeDirectory: string,
): boolean {
  if (directory === '~/' || directory.startsWith('~/')) {
    return true;
  }
  if (directory.startsWith('/') || /^[A-Za-z]:[\\/]/.test(directory)) {
    return true;
  }
  return Boolean(homeDirectory && directory);
}
