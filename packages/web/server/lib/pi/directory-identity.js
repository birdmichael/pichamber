import fs from 'node:fs';

// Same identity session list and getStatus use. A Wooly path with a
// different slash, case, or symlink must not list a session and omit it
// from GET /session/status.
export const normalizeHostDirectory = (directory) => {
  if (typeof directory !== 'string') return '';
  const trimmed = directory.trim();
  if (!trimmed) return '';
  let next = trimmed.replace(/\\/g, '/');
  if (next.length > 1) next = next.replace(/\/+$/, '');
  try {
    if (next && fs.existsSync(next)) return fs.realpathSync(next);
  } catch {
  }
  return next;
};

export const directoriesMatch = (left, right) => {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  if (left === right) return true;
  const a = normalizeHostDirectory(left);
  const b = normalizeHostDirectory(right);
  if (!a || !b) return false;
  if (a === b) return true;
  return a.toLowerCase() === b.toLowerCase();
};
