import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { directoriesMatch, normalizeHostDirectory } from './directory-identity.js';

describe('directoriesMatch', () => {
  const temps = [];

  afterEach(() => {
    for (const dir of temps.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('treats trailing slashes as the same project', () => {
    expect(directoriesMatch('/Users/me/Documents/Code/Wooly', '/Users/me/Documents/Code/Wooly/')).toBe(true);
  });

  it('resolves symlink aliases to the same project', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pichamber-372-'));
    temps.push(root);
    const real = path.join(root, 'wooly');
    const alias = path.join(root, 'wooly-link');
    fs.mkdirSync(real);
    fs.symlinkSync(real, alias);
    expect(directoriesMatch(real, alias)).toBe(true);
    expect(normalizeHostDirectory(alias)).toBe(fs.realpathSync(real));
  });
});
