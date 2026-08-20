import { describe, expect, it } from 'vitest';
import crypto from 'crypto';
import fsPromises from 'fs/promises';
import os from 'os';
import path from 'path';
import { createProjectIdFromPath } from '../projects/project-id.js';
import { createSettingsRuntime } from './settings-runtime.js';

const createRuntime = async () => {
  const tempRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'oc-settings-runtime-'));
  const settingsFilePath = path.join(tempRoot, 'settings.json');
  const runtime = createSettingsRuntime({
    fsPromises,
    path,
    crypto,
    SETTINGS_FILE_PATH: settingsFilePath,
    sanitizeProjects: (projects) => Array.isArray(projects) ? projects : [],
    sanitizeSettingsUpdate: (settings) => settings,
    mergePersistedSettings: (_current, changes) => changes,
    normalizeSettingsPaths: (settings) => ({ settings, changed: false }),
    normalizeStringArray: (values) => Array.isArray(values) ? values.filter((value) => typeof value === 'string') : [],
    formatSettingsResponse: (settings) => settings,
    resolveDirectoryCandidate: (value) => value,
    normalizeManagedRemoteTunnelHostname: (value) => value,
    normalizeManagedRemoteTunnelPresets: (value) => value,
    normalizeManagedRemoteTunnelPresetTokens: (value) => value,
    syncManagedRemoteTunnelConfigWithPresets: async () => {},
    upsertManagedRemoteTunnelToken: async () => {},
    home: tempRoot,
    env: {},
    tmpdir: path.join(tempRoot, 'skip-tmp'),
  });

  return {
    runtime,
    settingsFilePath,
    tempRoot,
    cleanup: async () => {
      await fsPromises.rm(tempRoot, { recursive: true, force: true });
    },
  };
};

describe('settings runtime', () => {
  it.skipIf(process.platform === 'win32')('writes settings with restrictive directory and file permissions', async () => {
    const { runtime, settingsFilePath, tempRoot, cleanup } = await createRuntime();
    try {
      await runtime.writeSettingsToDisk({ desktopUiPassword: 'secret' });

      expect((await fsPromises.stat(tempRoot)).mode & 0o777).toBe(0o700);
      expect((await fsPromises.stat(settingsFilePath)).mode & 0o777).toBe(0o600);
    } finally {
      await cleanup();
    }
  });

  it('only remaps project plan paths within the migrated storage directory', async () => {
    const { runtime, settingsFilePath, tempRoot, cleanup } = await createRuntime();
    try {
      const projectPath = path.join(tempRoot, 'project');
      const oldProjectId = 'legacy-project-id';
      const newProjectId = createProjectIdFromPath(projectPath);
      const projectsRoot = path.join(path.dirname(settingsFilePath), 'projects');
      const oldStorageDir = path.join(projectsRoot, oldProjectId);
      const newStorageDir = path.join(projectsRoot, newProjectId);
      const siblingStorageDir = `${oldStorageDir}-sibling`;

      await fsPromises.mkdir(projectPath, { recursive: true });
      await fsPromises.mkdir(projectsRoot, { recursive: true });
      await fsPromises.writeFile(
        settingsFilePath,
        JSON.stringify({
          projects: [{ id: oldProjectId, path: projectPath, addedAt: 1, lastOpenedAt: 1 }],
          activeProjectId: oldProjectId,
        }, null, 2),
        'utf8',
      );
      await fsPromises.writeFile(
        path.join(projectsRoot, `${oldProjectId}.json`),
        JSON.stringify({
          projectPlanFiles: [
            { id: 'inside', path: path.join(oldStorageDir, 'plans', 'inside.md') },
            { id: 'sibling', path: path.join(siblingStorageDir, 'plans', 'outside.md') },
          ],
        }, null, 2),
        'utf8',
      );

      await runtime.readSettingsFromDiskMigrated();

      const migratedConfig = JSON.parse(await fsPromises.readFile(path.join(projectsRoot, `${newProjectId}.json`), 'utf8'));
      expect(migratedConfig.projectPlanFiles).toEqual([
        { id: 'inside', path: path.join(newStorageDir, 'plans', 'inside.md') },
        { id: 'sibling', path: path.join(siblingStorageDir, 'plans', 'outside.md') },
      ]);
    } finally {
      await cleanup();
    }
  });

  it.skipIf(process.platform !== 'win32')('falls back when Windows blocks atomic settings replacement', async () => {
    const tempRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'oc-settings-runtime-'));
    const settingsFilePath = path.join(tempRoot, 'settings.json');
    const wrappedFs = {
      ...fsPromises,
      rename: async () => {
        const error = new Error('operation not permitted');
        error.code = 'EPERM';
        throw error;
      },
    };
    const runtime = createSettingsRuntime({
      fsPromises: wrappedFs,
      path,
      crypto,
      SETTINGS_FILE_PATH: settingsFilePath,
      sanitizeProjects: (projects) => Array.isArray(projects) ? projects : [],
      sanitizeSettingsUpdate: (settings) => settings,
      mergePersistedSettings: (_current, changes) => changes,
      normalizeSettingsPaths: (settings) => ({ settings, changed: false }),
      normalizeStringArray: (values) => Array.isArray(values) ? values.filter((value) => typeof value === 'string') : [],
      formatSettingsResponse: (settings) => settings,
      resolveDirectoryCandidate: (value) => value,
      normalizeManagedRemoteTunnelHostname: (value) => value,
      normalizeManagedRemoteTunnelPresets: (value) => value,
      normalizeManagedRemoteTunnelPresetTokens: (value) => value,
      syncManagedRemoteTunnelConfigWithPresets: async () => {},
      upsertManagedRemoteTunnelToken: async () => {},
      home: tempRoot,
      env: {},
      tmpdir: path.join(tempRoot, 'skip-tmp'),
    });

    try {
      await runtime.writeSettingsToDisk({ theme: 'dark' });

      await expect(fsPromises.readFile(settingsFilePath, 'utf8')).resolves.toBe(JSON.stringify({ theme: 'dark' }, null, 2));
    } finally {
      await fsPromises.rm(tempRoot, { recursive: true, force: true });
    }
  });

  const writeHeader = async (filePath, cwd, timestamp) => {
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

  it('seeds every existing Pi session cwd on first install and opens the newest', async () => {
    const { runtime, settingsFilePath, tempRoot, cleanup } = await createRuntime();
    const projectsRoot = await fsPromises.mkdtemp(path.join(os.homedir(), 'oc-seed-projects-'));
    const older = path.join(projectsRoot, 'older-app');
    const newer = path.join(projectsRoot, 'newer-app');
    await fsPromises.mkdir(older, { recursive: true });
    await fsPromises.mkdir(newer, { recursive: true });
    const sessionsRoot = path.join(tempRoot, '.pi', 'agent', 'sessions');
    await writeHeader(path.join(sessionsRoot, '--not-a-path-decode--', 'a.jsonl'), older, 1_000);
    await writeHeader(path.join(sessionsRoot, '--also-not-decoded--', 'b.jsonl'), newer, 8_000);
    await writeHeader(
      path.join(sessionsRoot, '--tmp-scratch--', 'c.jsonl'),
      path.join(os.tmpdir(), 'scratch'),
      9_000,
    );

    try {
      const settings = await runtime.readSettingsFromDiskMigrated();
      const persisted = JSON.parse(await fsPromises.readFile(settingsFilePath, 'utf8'));

      expect(settings.projects.map((project) => project.path)).toEqual([newer, older]);
      expect(settings.activeProjectId).toBe(createProjectIdFromPath(newer));
      expect(settings.lastDirectory).toBe(newer);
      expect(persisted.projects.map((project) => project.path)).toEqual([newer, older]);
      await expect(fsPromises.stat(path.join(tempRoot, '.pi', 'agent', 'pichamber.json'))).rejects.toMatchObject({
        code: 'ENOENT',
      });
    } finally {
      await fsPromises.rm(projectsRoot, { recursive: true, force: true });
      await cleanup();
    }
  });

  it('seeds when settings exist but projects has never been persisted', async () => {
    const { runtime, settingsFilePath, tempRoot, cleanup } = await createRuntime();
    const projectsRoot = await fsPromises.mkdtemp(path.join(os.homedir(), 'oc-seed-existing-'));
    const projectPath = path.join(projectsRoot, 'existing-app');
    await fsPromises.mkdir(projectPath, { recursive: true });
    await writeHeader(
      path.join(tempRoot, '.pi', 'agent', 'sessions', '--existing--', 'a.jsonl'),
      projectPath,
      4_000,
    );
    await fsPromises.writeFile(settingsFilePath, JSON.stringify({ lastDirectory: tempRoot }, null, 2), 'utf8');

    try {
      const settings = await runtime.readSettingsFromDiskMigrated();
      expect(settings.projects.map((project) => project.path)).toEqual([projectPath]);
      expect(settings.activeProjectId).toBe(createProjectIdFromPath(projectPath));
      expect(settings.lastDirectory).toBe(projectPath);
    } finally {
      await fsPromises.rm(projectsRoot, { recursive: true, force: true });
      await cleanup();
    }
  });

  it('does not rescan after Close Project persisted an empty projects array', async () => {
    const { runtime, settingsFilePath, tempRoot, cleanup } = await createRuntime();
    const projectPath = path.join(tempRoot, 'closed-app');
    await fsPromises.mkdir(projectPath, { recursive: true });
    await writeHeader(
      path.join(tempRoot, '.pi', 'agent', 'sessions', '--closed--', 'a.jsonl'),
      projectPath,
      4_000,
    );
    await fsPromises.writeFile(settingsFilePath, JSON.stringify({ projects: [] }, null, 2), 'utf8');

    try {
      const settings = await runtime.readSettingsFromDiskMigrated();
      expect(settings.projects).toEqual([]);
    } finally {
      await cleanup();
    }
  });

  it('keeps a first-install persist of empty projects from wiping the seed', async () => {
    const { runtime, settingsFilePath, tempRoot, cleanup } = await createRuntime();
    const projectsRoot = await fsPromises.mkdtemp(path.join(os.homedir(), 'oc-seed-kept-'));
    const projectPath = path.join(projectsRoot, 'kept-app');
    await fsPromises.mkdir(projectPath, { recursive: true });
    await writeHeader(
      path.join(tempRoot, '.pi', 'agent', 'sessions', '--kept--', 'a.jsonl'),
      projectPath,
      4_000,
    );

    try {
      const persisted = await runtime.persistSettings({ projects: [] });
      expect(persisted.projects.map((project) => project.path)).toEqual([projectPath]);
      expect(persisted.activeProjectId).toBe(createProjectIdFromPath(projectPath));
      const onDisk = JSON.parse(await fsPromises.readFile(settingsFilePath, 'utf8'));
      expect(onDisk.projects.map((project) => project.path)).toEqual([projectPath]);
    } finally {
      await fsPromises.rm(projectsRoot, { recursive: true, force: true });
      await cleanup();
    }
  });
});
