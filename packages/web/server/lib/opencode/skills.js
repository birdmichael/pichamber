import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  SKILL_DIR,
  OPENCODE_CONFIG_DIR,
  SKILL_SCOPE,
  ensureDirs,
  parseMdFile,
  writeMdFile,
  readConfigLayers,
  readConfig,
  walkSkillMdFiles,
  addSkillFromMdFile,
  resolveSkillSearchDirectories,
  listSkillSupportingFiles,
  readSkillSupportingFile,
  writeSkillSupportingFile,
  deleteSkillSupportingFile,
  getAncestors,
  findWorktreeRoot,
} from './shared.js';
import { isPiKernelEnabled } from '../pi/kernel.js';
import { resolvePiAgentDir } from '../pi/pi-resources.js';

const BUILT_IN_SKILL_LOCATION = '<built-in>';

function getProjectPiSkillDir(workingDirectory, skillName) {
  return path.join(workingDirectory, '.pi', 'skills', skillName);
}

function getProjectPiSkillPath(workingDirectory, skillName) {
  return path.join(getProjectPiSkillDir(workingDirectory, skillName), 'SKILL.md');
}

function getUserPiSkillDir(skillName) {
  return path.join(resolvePiAgentDir(os.homedir()), 'skills', skillName);
}

function getUserPiSkillPath(skillName) {
  return path.join(getUserPiSkillDir(skillName), 'SKILL.md');
}

function ensureProjectSkillDir(workingDirectory) {
  if (isPiKernelEnabled()) {
    const projectSkillDir = path.join(workingDirectory, '.pi', 'skills');
    fs.mkdirSync(projectSkillDir, { recursive: true });
    return projectSkillDir;
  }
  const projectSkillDir = path.join(workingDirectory, '.opencode', 'skills');
  if (!fs.existsSync(projectSkillDir)) {
    fs.mkdirSync(projectSkillDir, { recursive: true });
  }
  const legacyProjectSkillDir = path.join(workingDirectory, '.opencode', 'skill');
  if (!fs.existsSync(legacyProjectSkillDir)) {
    fs.mkdirSync(legacyProjectSkillDir, { recursive: true });
  }
  return projectSkillDir;
}

function getProjectSkillDir(workingDirectory, skillName) {
  if (isPiKernelEnabled()) {
    const piPath = getProjectPiSkillDir(workingDirectory, skillName);
    const leftover = path.join(workingDirectory, '.opencode', 'skills', skillName);
    if (fs.existsSync(leftover) && !fs.existsSync(piPath)) return leftover;
    return piPath;
  }
  const pluralPath = path.join(workingDirectory, '.opencode', 'skills', skillName);
  const legacyPath = path.join(workingDirectory, '.opencode', 'skill', skillName);
  if (fs.existsSync(legacyPath) && !fs.existsSync(pluralPath)) return legacyPath;
  return pluralPath;
}

function getProjectSkillPath(workingDirectory, skillName) {
  if (isPiKernelEnabled()) {
    const piPath = getProjectPiSkillPath(workingDirectory, skillName);
    const leftover = path.join(workingDirectory, '.opencode', 'skills', skillName, 'SKILL.md');
    if (fs.existsSync(leftover) && !fs.existsSync(piPath)) return leftover;
    return piPath;
  }
  const pluralPath = path.join(workingDirectory, '.opencode', 'skills', skillName, 'SKILL.md');
  const legacyPath = path.join(workingDirectory, '.opencode', 'skill', skillName, 'SKILL.md');
  if (fs.existsSync(legacyPath) && !fs.existsSync(pluralPath)) return legacyPath;
  return pluralPath;
}

function getUserSkillDir(skillName) {
  if (isPiKernelEnabled()) {
    const piPath = getUserPiSkillDir(skillName);
    const leftover = path.join(SKILL_DIR, skillName);
    if (fs.existsSync(leftover) && !fs.existsSync(piPath)) return leftover;
    return piPath;
  }
  const pluralPath = path.join(SKILL_DIR, skillName);
  const legacyPath = path.join(OPENCODE_CONFIG_DIR, 'skill', skillName);
  if (fs.existsSync(legacyPath) && !fs.existsSync(pluralPath)) return legacyPath;
  return pluralPath;
}

function getUserSkillPath(skillName) {
  if (isPiKernelEnabled()) {
    const piPath = getUserPiSkillPath(skillName);
    const leftover = path.join(SKILL_DIR, skillName, 'SKILL.md');
    if (fs.existsSync(leftover) && !fs.existsSync(piPath)) return leftover;
    return piPath;
  }
  const pluralPath = path.join(SKILL_DIR, skillName, 'SKILL.md');
  const legacyPath = path.join(OPENCODE_CONFIG_DIR, 'skill', skillName, 'SKILL.md');
  if (fs.existsSync(legacyPath) && !fs.existsSync(pluralPath)) return legacyPath;
  return pluralPath;
}

function getClaudeSkillDir(workingDirectory, skillName) {
  return path.join(workingDirectory, '.claude', 'skills', skillName);
}

function getClaudeSkillPath(workingDirectory, skillName) {
  return path.join(getClaudeSkillDir(workingDirectory, skillName), 'SKILL.md');
}

function getUserClaudeSkillDir(skillName) {
  return path.join(os.homedir(), '.claude', 'skills', skillName);
}

function getUserClaudeSkillPath(skillName) {
  return path.join(getUserClaudeSkillDir(skillName), 'SKILL.md');
}

function getUserAgentsSkillDir(skillName) {
  return path.join(os.homedir(), '.agents', 'skills', skillName);
}

function getUserAgentsSkillPath(skillName) {
  return path.join(getUserAgentsSkillDir(skillName), 'SKILL.md');
}

function getProjectAgentsSkillDir(workingDirectory, skillName) {
  return path.join(workingDirectory, '.agents', 'skills', skillName);
}

function getProjectAgentsSkillPath(workingDirectory, skillName) {
  return path.join(getProjectAgentsSkillDir(workingDirectory, skillName), 'SKILL.md');
}

function getPrimarySkillSource() {
  return isPiKernelEnabled() ? 'pi' : 'opencode';
}

function normalizeRequestedSkillSource(source) {
  if (source === 'agents' || source === 'claude') return source;
  return getPrimarySkillSource();
}

function isPathInside(candidatePath, parentPath) {
  if (!candidatePath || !parentPath) return false;
  const resolvedCandidate = path.resolve(candidatePath);
  const resolvedParent = path.resolve(parentPath);
  return resolvedCandidate === resolvedParent
    || resolvedCandidate.startsWith(`${resolvedParent}${path.sep}`);
}

function pathHasSkillRoot(resolvedPath, rootSegments) {
  const needle = `${path.sep}${rootSegments.join(path.sep)}${path.sep}`;
  return resolvedPath.includes(needle);
}

function isPiSkillPath(resolvedPath, home = os.homedir()) {
  if (pathHasSkillRoot(resolvedPath, ['.pi', 'skills'])) return true;
  return isPathInside(resolvedPath, path.join(resolvePiAgentDir(home), 'skills'));
}

function isOpenCodeSkillPath(resolvedPath, home = os.homedir()) {
  if (resolvedPath.includes(`${path.sep}.opencode${path.sep}`)) return true;
  const roots = [
    path.resolve(home, '.config', 'opencode'),
    path.resolve(home, '.opencode'),
    path.resolve(home, '.cache', 'opencode'),
    path.resolve(home, 'Library', 'Caches', 'opencode'),
  ];
  if (process.env.XDG_CACHE_HOME) {
    roots.push(path.resolve(process.env.XDG_CACHE_HOME, 'opencode'));
  }
  if (process.env.OPENCODE_CONFIG_DIR) {
    roots.push(path.resolve(process.env.OPENCODE_CONFIG_DIR));
  }
  return roots.some((root) => isPathInside(resolvedPath, root));
}

function inferSkillSourceFromPath(skillPath, home = os.homedir()) {
  const resolvedPath = typeof skillPath === 'string' ? path.resolve(skillPath) : '';
  if (pathHasSkillRoot(resolvedPath, ['.agents', 'skills'])) return 'agents';
  if (pathHasSkillRoot(resolvedPath, ['.claude', 'skills'])) return 'claude';
  if (isPiSkillPath(resolvedPath, home)) return 'pi';
  if (isOpenCodeSkillPath(resolvedPath, home)) return 'opencode';
  return getPrimarySkillSource();
}

function inferSkillScopeAndSourceFromPath(skillPath, workingDirectory) {
  const resolvedPath = typeof skillPath === 'string' ? path.resolve(skillPath) : '';
  const source = inferSkillSourceFromPath(resolvedPath);

  if (workingDirectory) {
    const worktreeRoot = findWorktreeRoot(workingDirectory) || path.resolve(workingDirectory);
    const isProjectScoped = getAncestors(workingDirectory, worktreeRoot).some((ancestor) => {
      const candidates = [
        path.join(ancestor, '.pi', 'skills'),
        path.join(ancestor, '.opencode'),
        path.join(ancestor, '.claude', 'skills'),
        path.join(ancestor, '.agents', 'skills'),
      ];
      return candidates.some((candidate) => isPathInside(resolvedPath, candidate));
    });
    if (isProjectScoped) {
      return { scope: SKILL_SCOPE.PROJECT, source };
    }
  }

  return { scope: SKILL_SCOPE.USER, source };
}

function getCanonicalProjectSkillDir(workingDirectory, skillName) {
  if (isPiKernelEnabled()) return getProjectPiSkillDir(workingDirectory, skillName);
  return path.join(workingDirectory, '.opencode', 'skills', skillName);
}

function getCanonicalProjectSkillPath(workingDirectory, skillName) {
  return path.join(getCanonicalProjectSkillDir(workingDirectory, skillName), 'SKILL.md');
}

function getCanonicalUserSkillDir(skillName) {
  if (isPiKernelEnabled()) return getUserPiSkillDir(skillName);
  return path.join(SKILL_DIR, skillName);
}

function getCanonicalUserSkillPath(skillName) {
  return path.join(getCanonicalUserSkillDir(skillName), 'SKILL.md');
}

function getSkillScope(skillName, workingDirectory) {
  const discovered = discoverSkills(workingDirectory).find((skill) => skill.name === skillName);
  if (discovered?.path) {
    return { scope: discovered.scope || null, path: discovered.path, source: discovered.source || null };
  }

  if (workingDirectory) {
    const projectPath = getProjectSkillPath(workingDirectory, skillName);
    if (fs.existsSync(projectPath)) {
      return { scope: SKILL_SCOPE.PROJECT, path: projectPath, source: inferSkillSourceFromPath(projectPath) };
    }
    
    const claudePath = getClaudeSkillPath(workingDirectory, skillName);
    if (fs.existsSync(claudePath)) {
      return { scope: SKILL_SCOPE.PROJECT, path: claudePath, source: 'claude' };
    }
  }
  
  const userPath = getUserSkillPath(skillName);
  if (fs.existsSync(userPath)) {
    return { scope: SKILL_SCOPE.USER, path: userPath, source: inferSkillSourceFromPath(userPath) };
  }

  const userClaudePath = getUserClaudeSkillPath(skillName);
  if (fs.existsSync(userClaudePath)) {
    return { scope: SKILL_SCOPE.USER, path: userClaudePath, source: 'claude' };
  }

  const userAgentsPath = getUserAgentsSkillPath(skillName);
  if (fs.existsSync(userAgentsPath)) {
    return { scope: SKILL_SCOPE.USER, path: userAgentsPath, source: 'agents' };
  }
  
  return { scope: null, path: null, source: null };
}

function getSkillWritePath(skillName, workingDirectory, requestedScope) {
  const existing = getSkillScope(skillName, workingDirectory);
  if (existing.path) {
    return existing;
  }
  
  const scope = requestedScope || SKILL_SCOPE.USER;
  if (scope === SKILL_SCOPE.PROJECT && workingDirectory) {
    return { 
      scope: SKILL_SCOPE.PROJECT, 
      path: getCanonicalProjectSkillPath(workingDirectory, skillName),
      source: getPrimarySkillSource()
    };
  }
  
  return { 
    scope: SKILL_SCOPE.USER, 
    path: getCanonicalUserSkillPath(skillName),
    source: getPrimarySkillSource()
  };
}

function discoverSkills(workingDirectory) {
  const skills = new Map();

  const homePiSkills = path.join(resolvePiAgentDir(os.homedir()), 'skills');
  for (const skillMdPath of walkSkillMdFiles(homePiSkills)) {
    addSkillFromMdFile(skills, skillMdPath, SKILL_SCOPE.USER, 'pi');
  }
  if (workingDirectory) {
    const worktreeRoot = findWorktreeRoot(workingDirectory) || path.resolve(workingDirectory);
    const ancestors = getAncestors(workingDirectory, worktreeRoot);
    for (const ancestor of ancestors) {
      for (const skillMdPath of walkSkillMdFiles(path.join(ancestor, '.pi', 'skills'))) {
        addSkillFromMdFile(skills, skillMdPath, SKILL_SCOPE.PROJECT, 'pi');
      }
    }
  }

  for (const externalRootName of ['.claude', '.agents']) {
    const homeRoot = path.join(os.homedir(), externalRootName, 'skills');
    const source = externalRootName === '.agents' ? 'agents' : 'claude';
    for (const skillMdPath of walkSkillMdFiles(homeRoot)) {
      addSkillFromMdFile(skills, skillMdPath, SKILL_SCOPE.USER, source);
    }
  }

  if (workingDirectory) {
    const worktreeRoot = findWorktreeRoot(workingDirectory) || path.resolve(workingDirectory);
    const ancestors = getAncestors(workingDirectory, worktreeRoot);
    for (const ancestor of ancestors) {
      for (const externalRootName of ['.claude', '.agents']) {
        const source = externalRootName === '.agents' ? 'agents' : 'claude';
        const externalSkillsRoot = path.join(ancestor, externalRootName, 'skills');
        for (const skillMdPath of walkSkillMdFiles(externalSkillsRoot)) {
          addSkillFromMdFile(skills, skillMdPath, SKILL_SCOPE.PROJECT, source);
        }
      }
    }
  }

  if (!isPiKernelEnabled()) {
    const configDirectories = resolveSkillSearchDirectories(workingDirectory);
    const homeOpencodeDir = path.resolve(path.join(os.homedir(), '.opencode'));
    const customConfigDir = process.env.OPENCODE_CONFIG_DIR
      ? path.resolve(process.env.OPENCODE_CONFIG_DIR)
      : null;
    for (const dir of configDirectories) {
      for (const subDir of ['skill', 'skills']) {
        const root = path.join(dir, subDir);
        for (const skillMdPath of walkSkillMdFiles(root)) {
          const isUserConfigDir = dir === OPENCODE_CONFIG_DIR
            || dir === homeOpencodeDir
            || (customConfigDir && dir === customConfigDir);
          const scope = isUserConfigDir ? SKILL_SCOPE.USER : SKILL_SCOPE.PROJECT;
          addSkillFromMdFile(skills, skillMdPath, scope, 'opencode');
        }
      }
    }

    let configuredPaths = [];
    try {
      const config = readConfig(workingDirectory);
      configuredPaths = Array.isArray(config?.skills?.paths) ? config.skills.paths : [];
    } catch {
      configuredPaths = [];
    }
    for (const skillPath of configuredPaths) {
      if (typeof skillPath !== 'string' || !skillPath.trim()) continue;
      const expanded = skillPath.startsWith('~/')
        ? path.join(os.homedir(), skillPath.slice(2))
        : skillPath;
      const resolved = path.isAbsolute(expanded)
        ? path.resolve(expanded)
        : path.resolve(workingDirectory || process.cwd(), expanded);
      for (const skillMdPath of walkSkillMdFiles(resolved)) {
        addSkillFromMdFile(skills, skillMdPath, SKILL_SCOPE.PROJECT, 'opencode');
      }
    }

    const cacheCandidates = [];
    if (process.env.XDG_CACHE_HOME) {
      cacheCandidates.push(path.join(process.env.XDG_CACHE_HOME, 'opencode', 'skills'));
    }
    cacheCandidates.push(path.join(os.homedir(), '.cache', 'opencode', 'skills'));
    cacheCandidates.push(path.join(os.homedir(), 'Library', 'Caches', 'opencode', 'skills'));

    for (const cacheRoot of cacheCandidates) {
      if (!fs.existsSync(cacheRoot)) continue;
      const entries = fs.readdirSync(cacheRoot, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const skillRoot = path.join(cacheRoot, entry.name);
        for (const skillMdPath of walkSkillMdFiles(skillRoot)) {
          addSkillFromMdFile(skills, skillMdPath, SKILL_SCOPE.USER, 'opencode');
        }
      }
    }
  }

  return Array.from(skills.values());
}

function mergeDiscoveredSkills(primarySkills = [], fallbackSkills = []) {
  const merged = [];
  const seenNames = new Set();

  const appendSkill = (skill) => {
    const name = typeof skill?.name === 'string' ? skill.name.trim() : '';
    if (!name || seenNames.has(name)) {
      return;
    }
    seenNames.add(name);
    merged.push(skill);
  };

  for (const skill of primarySkills || []) {
    appendSkill(skill);
  }
  for (const skill of fallbackSkills || []) {
    appendSkill(skill);
  }

  return merged;
}

function getSkillSources(skillName, workingDirectory, discoveredSkill = null) {
  const isReadableFile = (filePath) => {
    if (!filePath) return false;
    try {
      return fs.statSync(filePath).isFile();
    } catch {
      return false;
    }
  };

  const projectPath = workingDirectory ? getProjectSkillPath(workingDirectory, skillName) : null;
  const projectExists = projectPath && fs.existsSync(projectPath);
  const projectDir = projectExists ? path.dirname(projectPath) : null;
  
  const claudePath = workingDirectory ? getClaudeSkillPath(workingDirectory, skillName) : null;
  const claudeExists = claudePath && fs.existsSync(claudePath);
  const claudeDir = claudeExists ? path.dirname(claudePath) : null;
  const userClaudePath = getUserClaudeSkillPath(skillName);
  const userClaudeExists = fs.existsSync(userClaudePath);
  const userClaudeDir = userClaudeExists ? path.dirname(userClaudePath) : null;
  
  const userPath = getUserSkillPath(skillName);
  const userExists = fs.existsSync(userPath);
  const userDir = userExists ? path.dirname(userPath) : null;

  const userAgentsPath = getUserAgentsSkillPath(skillName);
  const userAgentsExists = fs.existsSync(userAgentsPath);
  const userAgentsDir = userAgentsExists ? path.dirname(userAgentsPath) : null;

  const matchedDiscovered = discoveredSkill && discoveredSkill.name === skillName
    ? discoveredSkill
    : discoverSkills(workingDirectory).find((skill) => skill.name === skillName);
  const discoveredDescription =
    matchedDiscovered && typeof matchedDiscovered.description === 'string'
      ? matchedDiscovered.description
      : '';
  const discoveredContent =
    matchedDiscovered && typeof matchedDiscovered.content === 'string'
      ? matchedDiscovered.content
      : '';
  const discoveredPath =
    matchedDiscovered && typeof matchedDiscovered.path === 'string'
      ? matchedDiscovered.path
      : null;
  const isBuiltInDiscovered = discoveredPath === BUILT_IN_SKILL_LOCATION;
  
  let mdPath = null;
  let mdScope = null;
  let mdSource = null;
  let mdDir = null;
  
  if (isBuiltInDiscovered) {
    mdScope = matchedDiscovered.scope || SKILL_SCOPE.USER;
    mdSource = matchedDiscovered.source || getPrimarySkillSource();
  } else if (discoveredPath) {
    mdPath = discoveredPath;
    mdScope = matchedDiscovered.scope || null;
    mdSource = matchedDiscovered.source || null;
    mdDir = isReadableFile(discoveredPath) ? path.dirname(discoveredPath) : null;
  } else if (projectExists) {
    mdPath = projectPath;
    mdScope = SKILL_SCOPE.PROJECT;
    mdSource = inferSkillSourceFromPath(projectPath);
    mdDir = projectDir;
  } else if (claudeExists) {
    mdPath = claudePath;
    mdScope = SKILL_SCOPE.PROJECT;
    mdSource = 'claude';
    mdDir = claudeDir;
  } else if (userExists) {
    mdPath = userPath;
    mdScope = SKILL_SCOPE.USER;
    mdSource = inferSkillSourceFromPath(userPath);
    mdDir = userDir;
  } else if (userClaudeExists) {
    mdPath = userClaudePath;
    mdScope = SKILL_SCOPE.USER;
    mdSource = 'claude';
    mdDir = userClaudeDir;
  } else if (userAgentsExists) {
    mdPath = userAgentsPath;
    mdScope = SKILL_SCOPE.USER;
    mdSource = 'agents';
    mdDir = userAgentsDir;
  }
  
  const mdExists = isBuiltInDiscovered || isReadableFile(mdPath);
  if (!mdExists) {
    mdPath = null;
    mdDir = null;
    mdScope = null;
    mdSource = null;
  }

  const sources = {
    md: {
      exists: mdExists,
      path: mdPath,
      dir: mdDir,
      scope: mdScope,
      source: mdSource,
      fields: isBuiltInDiscovered ? ['description', 'instructions'] : [],
      supportingFiles: [],
      name: matchedDiscovered?.name || skillName,
      description: discoveredDescription,
      instructions: isBuiltInDiscovered ? discoveredContent : ''
    },
    projectMd: {
      exists: projectExists,
      path: projectPath,
      dir: projectDir
    },
    claudeMd: {
      exists: claudeExists,
      path: claudePath,
      dir: claudeDir
    },
    userMd: {
      exists: userExists,
      path: userPath,
      dir: userDir
    },
    userClaudeMd: {
      exists: userClaudeExists,
      path: userClaudePath,
      dir: userClaudeDir
    },
    userAgentsMd: {
      exists: userAgentsExists,
      path: userAgentsPath,
      dir: userAgentsDir
    }
  };

  if (mdExists && mdDir) {
    const { frontmatter, body } = parseMdFile(mdPath);
    sources.md.fields = Object.keys(frontmatter);
    sources.md.description = frontmatter.description || '';
    sources.md.name = frontmatter.name || skillName;
    if (body) {
      sources.md.fields.push('instructions');
      sources.md.instructions = body;
    } else {
      sources.md.instructions = '';
    }
    sources.md.supportingFiles = listSkillSupportingFiles(mdDir);
  }

  return sources;
}

function isValidSkillName(skillName) {
  return typeof skillName === 'string'
    && skillName.length > 0
    && skillName.length <= 64
    && /^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/.test(skillName);
}

function assertValidSkillName(skillName) {
  if (!isValidSkillName(skillName)) {
    throw new Error(`Invalid skill name "${skillName}". Must be 1-64 lowercase alphanumeric characters with hyphens, cannot start or end with hyphen.`);
  }
}

function createSkill(skillName, config, workingDirectory, scope) {
  ensureDirs();
  assertValidSkillName(skillName);

  const existing = discoverSkills(workingDirectory).find((skill) => skill.name === skillName);
  if (existing?.path) {
    throw new Error(`Skill ${skillName} already exists at ${existing.path}`);
  }

  let targetDir;
  let targetPath;
  let targetScope;
  
  const requestedScope = scope === SKILL_SCOPE.PROJECT ? SKILL_SCOPE.PROJECT : SKILL_SCOPE.USER;
  const requestedSource = normalizeRequestedSkillSource(config?.source);

  if (requestedScope === SKILL_SCOPE.PROJECT && workingDirectory) {
    ensureProjectSkillDir(workingDirectory);
    if (requestedSource === 'agents') {
      targetDir = getProjectAgentsSkillDir(workingDirectory, skillName);
      targetPath = getProjectAgentsSkillPath(workingDirectory, skillName);
    } else {
      targetDir = getCanonicalProjectSkillDir(workingDirectory, skillName);
      targetPath = getCanonicalProjectSkillPath(workingDirectory, skillName);
    }
    targetScope = SKILL_SCOPE.PROJECT;
  } else {
    if (requestedSource === 'agents') {
      targetDir = getUserAgentsSkillDir(skillName);
      targetPath = getUserAgentsSkillPath(skillName);
    } else {
      targetDir = getCanonicalUserSkillDir(skillName);
      targetPath = getCanonicalUserSkillPath(skillName);
    }
    targetScope = SKILL_SCOPE.USER;
  }

  fs.mkdirSync(targetDir, { recursive: true });

  const { instructions, scope: _scopeFromConfig, source: _sourceFromConfig, supportingFiles, ...frontmatter } = config;
  void _scopeFromConfig;
  void _sourceFromConfig;

  if (!frontmatter.name) {
    frontmatter.name = skillName;
  }
  if (!frontmatter.description) {
    throw new Error('Skill description is required');
  }

  writeMdFile(targetPath, frontmatter, instructions || '');
  
  if (supportingFiles && Array.isArray(supportingFiles)) {
    for (const file of supportingFiles) {
      if (file.path && file.content !== undefined) {
        writeSkillSupportingFile(targetDir, file.path, file.content);
      }
    }
  }
  
  console.log(`Created new skill: ${skillName} (scope: ${targetScope}, path: ${targetPath})`);
}

function updateSkill(skillName, updates, workingDirectory, targetPath = null) {
  ensureDirs();

  const requestedPath = typeof targetPath === 'string' && targetPath.trim()
    ? path.resolve(targetPath.trim())
    : null;
  const existing = requestedPath && fs.existsSync(requestedPath)
    ? { scope: null, path: requestedPath, source: null }
    : getSkillScope(skillName, workingDirectory);
  if (!existing.path) {
    throw new Error(`Skill "${skillName}" not found`);
  }
  if (path.basename(existing.path) !== 'SKILL.md') {
    throw new Error(`Skill "${skillName}" target must be a SKILL.md file`);
  }
  
  const mdPath = existing.path;
  const mdDir = path.dirname(mdPath);
  const mdData = parseMdFile(mdPath);
  const frontmatterName = typeof mdData.frontmatter?.name === 'string' ? mdData.frontmatter.name : skillName;
  if (frontmatterName !== skillName) {
    throw new Error(`Skill "${skillName}" does not match ${mdPath}`);
  }

  let mdModified = false;

  for (const [field, value] of Object.entries(updates)) {
    if (field === 'scope' || field === 'source' || field === 'targetPath' || field === 'renameTo') {
      continue;
    }
    
    if (field === 'instructions') {
      const normalizedValue = typeof value === 'string' ? value : (value == null ? '' : String(value));
      mdData.body = normalizedValue;
      mdModified = true;
      continue;
    }

    if (field === 'supportingFiles') {
      if (Array.isArray(value)) {
        for (const file of value) {
          if (file.delete && file.path) {
            deleteSkillSupportingFile(mdDir, file.path);
          } else if (file.path && file.content !== undefined) {
            writeSkillSupportingFile(mdDir, file.path, file.content);
          }
        }
      }
      continue;
    }

    mdData.frontmatter[field] = value;
    mdModified = true;
  }

  if (mdModified) {
    writeMdFile(mdPath, mdData.frontmatter, mdData.body);
  }

  console.log(`Updated skill: ${skillName} (path: ${mdPath})`);
}

function deleteSkill(skillName, workingDirectory) {
  let deleted = false;

  if (workingDirectory) {
    const projectDir = getProjectSkillDir(workingDirectory, skillName);
    if (fs.existsSync(projectDir)) {
      fs.rmSync(projectDir, { recursive: true, force: true });
      console.log(`Deleted project-level skill directory: ${projectDir}`);
      deleted = true;
    }
    
    const claudeDir = getClaudeSkillDir(workingDirectory, skillName);
    if (fs.existsSync(claudeDir)) {
      fs.rmSync(claudeDir, { recursive: true, force: true });
      console.log(`Deleted claude-compat skill directory: ${claudeDir}`);
      deleted = true;
    }

    const projectAgentsDir = getProjectAgentsSkillDir(workingDirectory, skillName);
    if (fs.existsSync(projectAgentsDir)) {
      fs.rmSync(projectAgentsDir, { recursive: true, force: true });
      console.log(`Deleted project-level agents skill directory: ${projectAgentsDir}`);
      deleted = true;
    }
  }

  const userDir = getUserSkillDir(skillName);
  if (fs.existsSync(userDir)) {
    fs.rmSync(userDir, { recursive: true, force: true });
    console.log(`Deleted user-level skill directory: ${userDir}`);
    deleted = true;
  }

  const userAgentsDir = getUserAgentsSkillDir(skillName);
  if (fs.existsSync(userAgentsDir)) {
    fs.rmSync(userAgentsDir, { recursive: true, force: true });
    console.log(`Deleted user-level agents skill directory: ${userAgentsDir}`);
    deleted = true;
  }

  const userClaudeDir = getUserClaudeSkillDir(skillName);
  if (fs.existsSync(userClaudeDir)) {
    fs.rmSync(userClaudeDir, { recursive: true, force: true });
    console.log(`Deleted user-level claude skill directory: ${userClaudeDir}`);
    deleted = true;
  }

  if (!deleted) {
    throw new Error(`Skill "${skillName}" not found`);
  }
}

function getManagedSkillRoots(workingDirectory) {
  const roots = [];
  const pushRoot = (dir) => {
    if (!dir) return;
    const resolved = path.resolve(dir);
    if (!roots.includes(resolved)) {
      roots.push(resolved);
    }
  };
  const piKernel = isPiKernelEnabled();

  pushRoot(path.join(resolvePiAgentDir(os.homedir()), 'skills'));
  if (!piKernel) {
    pushRoot(SKILL_DIR);
    pushRoot(path.join(OPENCODE_CONFIG_DIR, 'skill'));
    pushRoot(path.join(os.homedir(), '.opencode', 'skills'));
    pushRoot(path.join(os.homedir(), '.opencode', 'skill'));
  }
  pushRoot(path.join(os.homedir(), '.claude', 'skills'));
  pushRoot(path.join(os.homedir(), '.agents', 'skills'));

  if (!piKernel) {
    const customConfigDir = process.env.OPENCODE_CONFIG_DIR
      ? path.resolve(process.env.OPENCODE_CONFIG_DIR)
      : null;
    if (customConfigDir) {
      pushRoot(path.join(customConfigDir, 'skills'));
      pushRoot(path.join(customConfigDir, 'skill'));
    }
  }

  if (workingDirectory) {
    const worktreeRoot = findWorktreeRoot(workingDirectory) || path.resolve(workingDirectory);
    for (const ancestor of getAncestors(workingDirectory, worktreeRoot)) {
      pushRoot(path.join(ancestor, '.pi', 'skills'));
      if (!piKernel) {
        pushRoot(path.join(ancestor, '.opencode', 'skills'));
        pushRoot(path.join(ancestor, '.opencode', 'skill'));
      }
      pushRoot(path.join(ancestor, '.claude', 'skills'));
      pushRoot(path.join(ancestor, '.agents', 'skills'));
    }
  }

  return roots;
}

function isManagedSkillPath(skillMdPath, workingDirectory) {
  if (!skillMdPath || skillMdPath === BUILT_IN_SKILL_LOCATION) {
    return false;
  }
  const skillDir = path.dirname(path.resolve(skillMdPath));
  return getManagedSkillRoots(workingDirectory).some((root) => isPathInside(skillDir, root));
}

function renameSkill(oldName, newName, workingDirectory) {
  ensureDirs();
  assertValidSkillName(newName);

  if (oldName === newName) {
    return;
  }

  const existing = getSkillScope(oldName, workingDirectory);
  if (!existing.path) {
    throw new Error(`Skill "${oldName}" not found`);
  }
  if (existing.path === BUILT_IN_SKILL_LOCATION || !fs.existsSync(existing.path)) {
    throw new Error(`Skill "${oldName}" cannot be renamed`);
  }
  if (path.basename(existing.path) !== 'SKILL.md') {
    throw new Error(`Skill "${oldName}" target must be a SKILL.md file`);
  }
  if (!isManagedSkillPath(existing.path, workingDirectory)) {
    throw new Error(`Skill "${oldName}" is outside managed skill directories and cannot be renamed`);
  }

  const mdDataBeforeMove = parseMdFile(existing.path);
  const frontmatterName = typeof mdDataBeforeMove.frontmatter?.name === 'string'
    ? mdDataBeforeMove.frontmatter.name
    : oldName;
  if (frontmatterName !== oldName) {
    throw new Error(`Skill "${oldName}" does not match ${existing.path}`);
  }

  const conflict = getSkillScope(newName, workingDirectory);
  if (conflict.path) {
    throw new Error(`Skill ${newName} already exists at ${conflict.path}`);
  }

  const oldDir = path.dirname(existing.path);
  const newDir = path.join(path.dirname(oldDir), newName);
  const directoriesDiffer = path.resolve(oldDir) !== path.resolve(newDir);

  if (directoriesDiffer && fs.existsSync(newDir)) {
    throw new Error(`Skill directory already exists at ${newDir}`);
  }

  // Rename the skill directory in place so supporting files and SKILL.md body are preserved.
  if (directoriesDiffer) {
    fs.renameSync(oldDir, newDir);
  }

  const newPath = path.join(newDir, 'SKILL.md');
  try {
    const mdData = parseMdFile(newPath);
    mdData.frontmatter = {
      ...mdData.frontmatter,
      name: newName,
    };
    writeMdFile(newPath, mdData.frontmatter, mdData.body);
  } catch (error) {
    if (directoriesDiffer && fs.existsSync(newDir) && !fs.existsSync(oldDir)) {
      try {
        fs.renameSync(newDir, oldDir);
      } catch (rollbackError) {
        console.error(`Failed to rollback skill rename from ${newDir} to ${oldDir}:`, rollbackError);
      }
    }
    throw error;
  }

  console.log(`Renamed skill: ${oldName} -> ${newName} (path: ${newPath})`);
}

export {
  getSkillSources,
  discoverSkills,
  mergeDiscoveredSkills,
  createSkill,
  updateSkill,
  deleteSkill,
  renameSkill,
  isManagedSkillPath,
  inferSkillScopeAndSourceFromPath,
};
