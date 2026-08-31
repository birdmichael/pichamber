/**
 * Resolve the Projects "Add project directory" path box into a list directory
 * and an optional leaf filter. `~` / `~/` must list the home folder even when
 * the client has not resolved $HOME yet — the server expands those paths.
 */

const WINDOWS_VOLUME_ROOT = /^[A-Za-z]:[\\/]/;

function isAbsoluteDirectoryPath(value: string): boolean {
  return value.startsWith('/') || WINDOWS_VOLUME_ROOT.test(value);
}

export function normalizeDirectoryExplorerQuery(query: string): string {
  const trimmed = query.trim();
  if (trimmed === '~') {
    return '~/';
  }
  // The field is prefilled `~/`. Typing or pasting an absolute path at the
  // caret concatenates (`~//tmp/foo`, `~/C:/Users/foo`). Drop the tilde
  // prefix so the displayed query and the resolved directory match.
  if (trimmed.startsWith('~/')) {
    const remainder = trimmed.slice(2);
    if (isAbsoluteDirectoryPath(remainder)) {
      return remainder;
    }
  }
  return trimmed;
}

/**
 * Apply an insert (typed or pasted) at the caret, then drop a concatenated
 * `~/` + absolute path. Needed because some desktop input paths (insertText)
 * update the native value without a React change event until the next render.
 */
export function applyDirectoryExplorerQueryEdit(
  query: string,
  inserted: string,
  selectionStart = query.length,
  selectionEnd = selectionStart,
): string {
  const start = Math.max(0, Math.min(selectionStart, query.length));
  const end = Math.max(start, Math.min(selectionEnd, query.length));
  const merged = `${query.slice(0, start)}${inserted}${query.slice(end)}`.replace(/\\/g, '/');
  return normalizeDirectoryExplorerQuery(merged);
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
  if (isAbsoluteDirectoryPath(directory)) {
    return true;
  }
  return Boolean(homeDirectory && directory);
}
