/**
 * Turn unbounded git stash apply/pop stderr (often a full `git status` dump)
 * into a short toast-safe message while preserving conflict path names.
 */

const OVERWRITE_HEADER =
  /Your local changes to the following files would be overwritten by (?:merge|checkout):\r?\n/i;

const OVERWRITE_STOP = /^(Please commit|Aborting|error:|fatal:|Index was not unstashed)/i;

/**
 * Status chrome / porcelain-ish rows. Do not match bare path lines — those are
 * the overwrite conflict targets listed under the header above.
 */
const STATUS_NOISE =
  /^(On branch |Changes to be committed:|Changes not staged for commit:|Untracked files:|no changes added to commit|Index was not unstashed\.?$|\(use |(new file|modified|deleted|renamed|both modified|both added|deleted by us|deleted by them):\s)/i;

export const STASH_ACTION_ERROR_TOAST_MAX_LENGTH = 200;
export const STASH_ACTION_ERROR_MAX_PATHS = 3;

export function extractLocalChangesOverwritePaths(raw: string): string[] {
  const text = String(raw || '');
  const header = text.match(OVERWRITE_HEADER);
  if (!header || header.index == null) {
    return [];
  }

  const after = text.slice(header.index + header[0].length);
  const paths: string[] = [];
  for (const line of after.split(/\r?\n/)) {
    const trimmed = line.replace(/^\t+/, '').trim();
    if (!trimmed) {
      if (paths.length > 0) break;
      continue;
    }
    if (OVERWRITE_STOP.test(trimmed)) break;
    // Status file rows look like "modified: x"; bare paths are conflict targets.
    if (STATUS_NOISE.test(trimmed)) break;
    paths.push(trimmed);
  }
  return paths;
}

export function clipGitErrorForToast(
  raw: string,
  maxLength: number = STASH_ACTION_ERROR_TOAST_MAX_LENGTH,
): string {
  const lines = String(raw || '')
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => {
      const trimmed = line.replace(/^\t+/, '').trim();
      if (!trimmed) return false;
      return !STATUS_NOISE.test(trimmed);
    });

  const preferred = lines.filter((line) => /^(error:|fatal:)/i.test(line.trim()));
  const text = (preferred.length > 0 ? preferred : lines).join(' ').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

export type StashActionErrorParse =
  | { kind: 'overwrite'; paths: string[] }
  | { kind: 'message'; text: string };

export function parseStashActionError(raw: unknown): StashActionErrorParse {
  const text = raw instanceof Error ? raw.message : String(raw ?? '');
  const paths = extractLocalChangesOverwritePaths(text);
  if (paths.length > 0) {
    return { kind: 'overwrite', paths };
  }
  return { kind: 'message', text: clipGitErrorForToast(text) };
}

export function formatOverwritePathsLabel(
  paths: readonly string[],
  maxPaths: number = STASH_ACTION_ERROR_MAX_PATHS,
): { pathsLabel: string; extraCount: number } {
  const unique = [...new Set(paths.map((path) => path.trim()).filter(Boolean))];
  const shown = unique.slice(0, Math.max(1, maxPaths));
  return {
    pathsLabel: shown.join(', '),
    extraCount: Math.max(0, unique.length - shown.length),
  };
}

/**
 * Build the toast string for a stash apply/pop/drop failure.
 * `formatOverwrite` / `formatOverwriteWithMore` come from i18n `t(...)`.
 */
export function summarizeStashActionError(
  raw: unknown,
  options: {
    fallback: string;
    formatOverwrite: (pathsLabel: string) => string;
    formatOverwriteWithMore: (pathsLabel: string, extraCount: number) => string;
    maxPaths?: number;
  },
): string {
  const parsed = parseStashActionError(raw);
  if (parsed.kind === 'overwrite') {
    const { pathsLabel, extraCount } = formatOverwritePathsLabel(parsed.paths, options.maxPaths);
    if (!pathsLabel) return options.fallback;
    return extraCount > 0
      ? options.formatOverwriteWithMore(pathsLabel, extraCount)
      : options.formatOverwrite(pathsLabel);
  }
  return parsed.text || options.fallback;
}
