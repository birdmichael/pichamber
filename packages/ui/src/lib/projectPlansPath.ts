import {
  DEFAULT_PLANS_DIR,
  resolvePlansDirRelative,
  type SharedProjectConfigRead,
} from './sharedProjectConfig';

type ProjectRef = { id: string; path: string };

const normalize = (value: string): string => {
  if (!value) return '';
  const replaced = value.replace(/\\/g, '/');
  return replaced === '/' ? '/' : replaced.replace(/\/+$/, '');
};

const joinPath = (base: string, segment: string): string => {
  const normalizedBase = normalize(base);
  const cleanSegment = segment.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
  if (!normalizedBase || normalizedBase === '/') {
    return `/${cleanSegment}`;
  }
  return `${normalizedBase}/${cleanSegment}`;
};

const joinRelative = (projectDirectory: string, relative: string): string => {
  const segments = relative.split('/').filter(Boolean);
  return segments.reduce((acc, segment) => joinPath(acc, segment), normalize(projectDirectory));
};

/**
 * Default plans folder when no shared `plansDir` is set: `<project>/.pichamber/plans`.
 * Real project folder for Save as plan — not ~/.config/pichamber/projects.
 */
export const resolveProjectPlansDirectory = (project: ProjectRef): string | null => {
  const projectDirectory = typeof project?.path === 'string' ? project.path.trim() : '';
  if (!projectDirectory) {
    return null;
  }
  return joinRelative(projectDirectory, DEFAULT_PLANS_DIR);
};

/**
 * Absolute repository plans folder: shared `plansDir` when set, else the default.
 * Setting `plansDir` replaces the default outright; moving files is the user's job.
 */
export const resolveProjectPlansDirectoryFromShared = (
  project: ProjectRef,
  shared: SharedProjectConfigRead | null | undefined,
): string | null => {
  const projectDirectory = typeof project?.path === 'string' ? project.path.trim() : '';
  if (!projectDirectory) {
    return null;
  }
  const relative = shared ? resolvePlansDirRelative(shared) : DEFAULT_PLANS_DIR;
  return joinRelative(projectDirectory, relative);
};
