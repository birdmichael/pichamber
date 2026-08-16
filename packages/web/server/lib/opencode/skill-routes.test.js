import { afterEach, describe, expect, it } from 'vitest';
import express from 'express';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { registerSkillRoutes } from './skill-routes.js';
import {
  createSkill,
  deleteSkill,
  discoverSkills,
  getSkillSources,
  isManagedSkillPath,
  mergeDiscoveredSkills,
  renameSkill,
  updateSkill,
} from './skills.js';
import {
  SKILL_DIR,
  SKILL_SCOPE,
  deleteSkillSupportingFile,
  readSkillSupportingFile,
  writeSkillSupportingFile,
} from './shared.js';

const createTempProject = () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'oc-skill-routes-'));
  fs.mkdirSync(path.join(projectRoot, '.git'));
  return projectRoot;
};

const startSkillsApp = ({ projectRoot, extraDependencies = {} }) => {
  const app = express();
  app.use(express.json());

  registerSkillRoutes(app, {
    fs,
    path,
    os,
    resolveProjectDirectory: async () => ({ directory: projectRoot, error: null }),
    resolveOptionalProjectDirectory: async (req) => {
      const queryDirectory = Array.isArray(req.query?.directory)
        ? req.query.directory[0]
        : req.query?.directory;
      if (!queryDirectory) {
        return { directory: null, error: null };
      }
      return { directory: String(queryDirectory), error: null };
    },
    readSettingsFromDisk: async () => ({}),
    sanitizeSkillCatalogs: (value) => value,
    isUnsafeSkillRelativePath: () => false,
    refreshOpenCodeAfterConfigChange: async () => {},
    clientReloadDelayMs: 0,
    buildOpenCodeUrl: () => 'http://127.0.0.1:9/',
    getOpenCodeAuthHeaders: () => ({}),
    getOpenCodePort: () => 0,
    getSkillSources,
    discoverSkills,
    mergeDiscoveredSkills,
    createSkill,
    updateSkill,
    deleteSkill,
    renameSkill,
    isManagedSkillPath,
    readSkillSupportingFile,
    writeSkillSupportingFile,
    deleteSkillSupportingFile,
    SKILL_SCOPE,
    SKILL_DIR,
    getCuratedSkillsSources: () => [],
    getCacheKey: () => 'k',
    getCachedScan: () => null,
    setCachedScan: () => {},
    parseSkillRepoSource: () => ({ ok: false }),
    scanSkillsRepository: async () => ({ ok: false }),
    installSkillsFromRepository: async () => ({ ok: false }),
    scanClawdHubPage: async () => ({ ok: false }),
    installSkillsFromClawdHub: async () => ({ ok: false }),
    isClawdHubSource: () => false,
    getProfiles: () => [],
    getProfile: () => null,
    ...extraDependencies,
  });

  const server = app.listen(0);
  const { port } = server.address();
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    }),
  };
};

describe('skill-routes directory soft fallback', () => {
  /** @type {string | null} */
  let projectRoot = null;
  /** @type {{ close: () => Promise<void> } | null} */
  let appHandle = null;

  afterEach(async () => {
    if (appHandle) {
      await appHandle.close();
      appHandle = null;
    }
    if (projectRoot) {
      fs.rmSync(projectRoot, { recursive: true, force: true });
      projectRoot = null;
    }
  });

  it('lists repository-local .agents skills after create even when list omits directory', async () => {
    projectRoot = createTempProject();
    appHandle = startSkillsApp({ projectRoot });

    const createResponse = await fetch(`${appHandle.baseUrl}/api/config/skills/repo-local-skill`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        description: 'Created without list directory',
        instructions: 'Do the thing.',
        scope: 'project',
        source: 'agents',
      }),
    });
    expect(createResponse.status).toBe(200);
    expect(fs.existsSync(path.join(projectRoot, '.agents', 'skills', 'repo-local-skill', 'SKILL.md'))).toBe(true);

    const listResponse = await fetch(`${appHandle.baseUrl}/api/config/skills`);
    expect(listResponse.status).toBe(200);
    const payload = await listResponse.json();
    expect(payload.skills.map((skill) => skill.name)).toContain('repo-local-skill');
    const skill = payload.skills.find((entry) => entry.name === 'repo-local-skill');
    expect(skill.scope).toBe('project');
    expect(skill.source).toBe('agents');
  });

  it('lists manually created repository-local .agents skills via active-project fallback', async () => {
    projectRoot = createTempProject();
    const skillDir = path.join(projectRoot, '.agents', 'skills', 'manual-repo-skill');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillDir, 'SKILL.md'),
      [
        '---',
        'name: manual-repo-skill',
        'description: Manual repository skill',
        '---',
        '',
        'Instructions',
        '',
      ].join('\n'),
      'utf8',
    );

    appHandle = startSkillsApp({ projectRoot });
    const listResponse = await fetch(`${appHandle.baseUrl}/api/config/skills`);
    expect(listResponse.status).toBe(200);
    const payload = await listResponse.json();
    expect(payload.skills.map((skill) => skill.name)).toContain('manual-repo-skill');
  });

  it('marks managed-root skills renamable and cache skills not renamable', async () => {
    projectRoot = createTempProject();
    const managedDir = path.join(projectRoot, '.opencode', 'skills', 'managed-list-skill');
    fs.mkdirSync(managedDir, { recursive: true });
    fs.writeFileSync(
      path.join(managedDir, 'SKILL.md'),
      [
        '---',
        'name: managed-list-skill',
        'description: Managed list skill',
        '---',
        '',
        'Managed body',
        '',
      ].join('\n'),
      'utf8',
    );

    const cacheStamp = `oc-skill-routes-${Date.now()}`;
    const cacheDir = path.join(os.homedir(), '.cache', 'opencode', 'skills', cacheStamp, 'cache-list-skill');
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(
      path.join(cacheDir, 'SKILL.md'),
      [
        '---',
        'name: cache-list-skill',
        'description: Cache list skill',
        '---',
        '',
        'Cache body',
        '',
      ].join('\n'),
      'utf8',
    );

    try {
      appHandle = startSkillsApp({ projectRoot });
      const listResponse = await fetch(
        `${appHandle.baseUrl}/api/config/skills?directory=${encodeURIComponent(projectRoot)}`,
      );
      expect(listResponse.status).toBe(200);
      const payload = await listResponse.json();

      const managed = payload.skills.find((entry) => entry.name === 'managed-list-skill');
      const cached = payload.skills.find((entry) => entry.name === 'cache-list-skill');

      expect(managed).toBeTruthy();
      expect(managed.renamable).toBe(true);
      expect(cached).toBeTruthy();
      expect(cached.renamable).toBe(false);
    } finally {
      fs.rmSync(path.join(os.homedir(), '.cache', 'opencode', 'skills', cacheStamp), {
        recursive: true,
        force: true,
      });
    }
  });
});

describe('skill-routes Pi config skills', () => {
  /** @type {{ close: () => Promise<void> } | null} */
  let appHandle = null;

  afterEach(async () => {
    if (appHandle) {
      await appHandle.close();
      appHandle = null;
    }
  });

  it('returns getConfigSkills payload with projectTrust and injected, without OpenCode', async () => {
    const projectRoot = '/tmp/pi-skills-project';
    let discovered = false;
    const payload = {
      skills: [
        { name: 'review', scope: 'user', injected: true },
        { name: 'local', scope: 'project', injected: false },
      ],
      projectTrust: {
        trusted: false,
        defaultProjectTrust: false,
        current: null,
      },
      externalSkills: { claudeDisabled: false, allDisabled: false },
    };

    appHandle = startSkillsApp({
      projectRoot,
      extraDependencies: {
        getPiHost: () => ({
          getConfigSkills: (directory) => {
            expect(directory).toBe(projectRoot);
            return payload;
          },
        }),
        discoverSkills: () => {
          discovered = true;
          throw new Error('OpenCode discovery should not run on the Pi kernel');
        },
        getOpenCodePort: () => {
          throw new Error('OpenCode port should not be required');
        },
      },
    });

    const listResponse = await fetch(
      `${appHandle.baseUrl}/api/config/skills?directory=${encodeURIComponent(projectRoot)}`,
    );
    expect(listResponse.status).toBe(200);
    const body = await listResponse.json();
    expect(body).toEqual(payload);
    expect(body.projectTrust.trusted).toBe(false);
    expect(body.skills.find((skill) => skill.name === 'local').injected).toBe(false);
    expect(discovered).toBe(false);
  });

  it('returns getSkillDetail for a nested symlink skill with a YAML block description', async () => {
    const projectRoot = '/tmp/pi-skills-detail-project';
    const skillPath = '/tmp/home/.agents/skills/superpowers/brainstorming/SKILL.md';
    const description = 'This skill brainstorms approaches.\nSecond line stays in the blurb.';
    const detail = {
      name: 'brainstorming',
      exists: true,
      scope: 'user',
      source: 'agents',
      sources: {
        md: {
          exists: true,
          path: skillPath,
          dir: path.dirname(skillPath),
          fields: ['name', 'description', 'instructions'],
          scope: 'user',
          source: 'agents',
          supportingFiles: [],
          name: 'brainstorming',
          description,
          instructions: 'Ask clarifying questions first.',
        },
      },
    };

    appHandle = startSkillsApp({
      projectRoot,
      extraDependencies: {
        getPiHost: () => ({
          getConfigSkills: () => ({ skills: [{ name: 'brainstorming', path: skillPath }] }),
          getSkillDetail: (directory, name) => {
            expect(directory).toBe(projectRoot);
            expect(name).toBe('brainstorming');
            return detail;
          },
        }),
        getSkillSources: () => {
          throw new Error('OpenCode getSkillSources should not run when Pi detail exists');
        },
        getOpenCodePort: () => {
          throw new Error('OpenCode port should not be required');
        },
      },
    });

    const response = await fetch(
      `${appHandle.baseUrl}/api/config/skills/brainstorming?directory=${encodeURIComponent(projectRoot)}`,
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.exists).toBe(true);
    expect(body.sources.md.path).toBe(skillPath);
    expect(body.sources.md.description).toBe(description);
    expect(body.sources.md.description).not.toBe('|');
    expect(body.sources.md.instructions).toBe('Ask clarifying questions first.');
  });
});
