import { describe, expect, it } from 'vitest';
import fsPromises from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  discoverPiSessionProjects,
  isSkippedPiSessionProjectCwd,
  projectLabelFromPath,
  settingsNeverPersistedProjects,
} from './pi-session-projects.js';

const writeSessionJsonl = async (filePath, cwd, timestamp) => {
  await fsPromises.mkdir(path.dirname(filePath), { recursive: true });
  await fsPromises.writeFile(
    filePath,
    `${JSON.stringify({
      type: 'session',
      cwd,
      timestamp: new Date(timestamp).toISOString(),
    })}\n`,
    'utf8',
  );
  await fsPromises.utimes(filePath, new Date(timestamp), new Date(timestamp));
};

describe('pi session project discovery', () => {
  it('treats a missing projects key as first install and an empty array as closed', () => {
    expect(settingsNeverPersistedProjects(undefined)).toBe(true);
    expect(settingsNeverPersistedProjects({})).toBe(true);
    expect(settingsNeverPersistedProjects({ lastDirectory: '/repo' })).toBe(true);
    expect(settingsNeverPersistedProjects({ projects: [] })).toBe(false);
    expect(settingsNeverPersistedProjects({ projects: [{ path: '/repo' }] })).toBe(false);
  });

  it('skips tmp, node_modules, and leftover Cursor/cloud worktree paths', () => {
    expect(isSkippedPiSessionProjectCwd('/tmp/scratch', { tmpdir: '/var/tmp' })).toBe(true);
    expect(isSkippedPiSessionProjectCwd('/private/tmp/scratch', { tmpdir: '/var/tmp' })).toBe(true);
    expect(isSkippedPiSessionProjectCwd('/var/folders/zz/T/work', { tmpdir: '/var/folders/zz/T' })).toBe(true);
    expect(isSkippedPiSessionProjectCwd('/var/tmp/scratch', { tmpdir: '/var/tmp' })).toBe(true);
    expect(isSkippedPiSessionProjectCwd('/repo/node_modules/pkg', { tmpdir: '/var/tmp' })).toBe(true);
    expect(isSkippedPiSessionProjectCwd('/home/box/.cursor/worktrees/app', { tmpdir: '/var/tmp' })).toBe(true);
    expect(isSkippedPiSessionProjectCwd('/worktrees/cursor/desktop-create-pr-e123', { tmpdir: '/var/tmp' })).toBe(true);
    expect(isSkippedPiSessionProjectCwd('/repo/.git/worktrees/feature', { tmpdir: '/var/tmp' })).toBe(true);
    expect(isSkippedPiSessionProjectCwd('/repo/.worktrees/cursor-desktop-plan-side-p456', { tmpdir: '/var/tmp' })).toBe(true);
    expect(isSkippedPiSessionProjectCwd('/repo/app', { tmpdir: '/var/tmp' })).toBe(false);
    expect(isSkippedPiSessionProjectCwd('/home/box/.config/openchamber/chats/2026-08-21/session-a', {
      tmpdir: '/var/tmp',
      home: '/home/box',
    })).toBe(true);
    expect(isSkippedPiSessionProjectCwd('/home/box', { tmpdir: '/var/tmp', home: '/home/box' })).toBe(true);
    expect(isSkippedPiSessionProjectCwd('/home/box/pichamber', { tmpdir: '/var/tmp', home: '/home/box' })).toBe(false);
    expect(projectLabelFromPath('/repo/app')).toBe('app');
    expect(projectLabelFromPath('/')).toBe('Root');
  });

  it('reads cwd from session headers, not encoded folder names', async () => {
    // Keep-paths must not live under /tmp or os.tmpdir(); those cwds are skipped.
    const home = await fsPromises.mkdtemp(path.join(os.homedir(), 'pi-session-projects-'));
    const older = path.join(home, 'older-app');
    const newer = path.join(home, 'newer-app');
    const missing = path.join(home, 'deleted-app');
    const tmpProject = path.join(home, 'tmp-work');
    const nestedModules = path.join(home, 'app', 'node_modules', 'pkg');
    const leftoverCursor = path.join(home, 'worktrees', 'cursor', 'desktop-create-pr-e123');
    await fsPromises.mkdir(older, { recursive: true });
    await fsPromises.mkdir(newer, { recursive: true });
    await fsPromises.mkdir(tmpProject, { recursive: true });
    await fsPromises.mkdir(nestedModules, { recursive: true });
    await fsPromises.mkdir(leftoverCursor, { recursive: true });

    const sessionsRoot = path.join(home, '.pi', 'agent', 'sessions');
    const olderDir = path.join(sessionsRoot, '--encoded-older-name--');
    const newerDir = path.join(sessionsRoot, '--encoded-newer-name--');
    const missingDir = path.join(sessionsRoot, '--encoded-missing-name--');
    const tmpDir = path.join(sessionsRoot, '--encoded-tmp-name--');
    const modulesDir = path.join(sessionsRoot, '--encoded-modules-name--');
    const leftoverDir = path.join(sessionsRoot, '--encoded-cursor-name--');
    const unreadableDir = path.join(sessionsRoot, '--encoded-bad-name--');
    const archiveOnly = path.join(sessionsRoot, 'archive');

    await writeSessionJsonl(path.join(olderDir, 'a.jsonl'), older, 1_000);
    await writeSessionJsonl(path.join(newerDir, 'b.jsonl'), newer, 5_000);
    await writeSessionJsonl(path.join(missingDir, 'c.jsonl'), missing, 9_000);
    await writeSessionJsonl(path.join(tmpDir, 'd.jsonl'), path.join(os.tmpdir(), 'scratch'), 8_000);
    await writeSessionJsonl(path.join(modulesDir, 'e.jsonl'), nestedModules, 7_000);
    await writeSessionJsonl(path.join(leftoverDir, 'f.jsonl'), leftoverCursor, 8_500);
    await fsPromises.mkdir(path.join(unreadableDir, 'child'), { recursive: true });
    await writeSessionJsonl(path.join(unreadableDir, 'child', 'nested.jsonl'), older, 6_000);
    await fsPromises.writeFile(path.join(unreadableDir, 'broken.jsonl'), '{not-json\n', 'utf8');
    await writeSessionJsonl(path.join(archiveOnly, 'archived.jsonl'), newer, 9_500);
    await writeSessionJsonl(path.join(newerDir, 'archive', 'old.jsonl'), newer, 9_999);

    try {
      const discovered = await discoverPiSessionProjects({
        agentDir: path.join(home, '.pi', 'agent'),
        fsPromises,
        path,
        tmpdir: path.join(home, 'skip-tmp'),
      });

      expect(discovered.map((entry) => entry.path)).toEqual([newer, older]);
      expect(discovered[0].label).toBe('newer-app');
      expect(discovered[0].lastUpdated).toBeGreaterThan(discovered[1].lastUpdated);
    } finally {
      await fsPromises.rm(home, { recursive: true, force: true });
    }
  });
});
