import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];

export const DEFAULT_PI_SETTINGS = {
  model: '',
  thinking: 'medium',
  compaction: true,
  retry: true,
};

export const BUILTIN_COMMANDS = [
  { name: 'compact', description: 'Compact session context', source: 'builtin', template: '' },
  { name: 'reload', description: 'Reload skills, prompts, and context files', source: 'builtin', template: '' },
  { name: 'model', description: 'Select a model', source: 'builtin', template: '' },
  { name: 'thinking', description: 'Set thinking level', source: 'builtin', template: '' },
  { name: 'login', description: 'Authenticate a provider', source: 'builtin', template: '' },
];

const isDirectory = (value) => {
  try {
    return fs.statSync(value).isDirectory();
  } catch {
    return false;
  }
};

const isFile = (value) => {
  try {
    return fs.statSync(value).isFile();
  } catch {
    return false;
  }
};

const readText = (filePath) => {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return '';
  }
};

export const parseMarkdownFrontmatter = (text) => {
  const source = typeof text === 'string' ? text : '';
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) {
    return { attributes: {}, body: source.trim() };
  }
  const attributes = {};
  for (const line of match[1].split(/\r?\n/)) {
    const index = line.indexOf(':');
    if (index <= 0) continue;
    const key = line.slice(0, index).trim();
    let value = line.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key) attributes[key] = value;
  }
  return { attributes, body: match[2].trim() };
};

const walkFiles = (root, predicate, results = []) => {
  if (!isDirectory(root)) return results;
  let entries = [];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      walkFiles(fullPath, predicate, results);
      continue;
    }
    if (entry.isFile() && predicate(entry.name, fullPath)) {
      results.push(fullPath);
    }
  }
  return results;
};

export const resolvePiAgentDir = (home = os.homedir()) => path.join(home, '.pi', 'agent');

export const resolvePiDefaultsPath = (home = os.homedir()) => path.join(resolvePiAgentDir(home), 'pichamber.json');

export const listPiSkillRoots = ({ home = os.homedir(), directory } = {}) => {
  const roots = [
    { root: path.join(home, '.pi', 'agent', 'skills'), scope: 'user', source: 'pi' },
    { root: path.join(home, '.agents', 'skills'), scope: 'user', source: 'agents' },
  ];
  if (directory) {
    roots.push(
      { root: path.join(directory, '.pi', 'skills'), scope: 'project', source: 'pi' },
      { root: path.join(directory, '.agents', 'skills'), scope: 'project', source: 'agents' },
    );
  }
  return roots;
};

export const listPiPromptRoots = ({ home = os.homedir(), directory } = {}) => {
  const roots = [
    { root: path.join(home, '.pi', 'agent', 'prompts'), scope: 'user', source: 'pi' },
  ];
  if (directory) {
    roots.push({ root: path.join(directory, '.pi', 'prompts'), scope: 'project', source: 'pi' });
  }
  return roots;
};

export const listPiSkills = ({ home = os.homedir(), directory } = {}) => {
  const skills = [];
  const seen = new Set();
  for (const { root, scope, source } of listPiSkillRoots({ home, directory })) {
    for (const skillPath of walkFiles(root, (name) => name === 'SKILL.md')) {
      const name = path.basename(path.dirname(skillPath));
      const key = `${scope}:${name}`;
      if (!name || seen.has(key)) continue;
      seen.add(key);
      const parsed = parseMarkdownFrontmatter(readText(skillPath));
      skills.push({
        name,
        path: skillPath,
        scope,
        source,
        description: parsed.attributes.description || parsed.attributes.name || '',
        content: parsed.body,
        sources: {
          md: {
            exists: true,
            path: skillPath,
            dir: path.dirname(skillPath),
            fields: Object.keys(parsed.attributes),
            scope,
            source,
            supportingFiles: [],
            name,
            description: parsed.attributes.description || '',
            instructions: parsed.body,
          },
        },
        renamable: true,
      });
    }
  }
  return skills;
};

export const listPiPrompts = ({ home = os.homedir(), directory } = {}) => {
  const prompts = [];
  const seen = new Set();
  for (const { root, scope, source } of listPiPromptRoots({ home, directory })) {
    for (const promptPath of walkFiles(root, (name) => name.endsWith('.md'))) {
      const name = path.basename(promptPath, '.md');
      const key = `${scope}:${name}`;
      if (!name || seen.has(key)) continue;
      seen.add(key);
      const parsed = parseMarkdownFrontmatter(readText(promptPath));
      prompts.push({
        name,
        path: promptPath,
        scope,
        source,
        description: parsed.attributes.description || parsed.attributes.name || `/${name}`,
        template: parsed.body || readText(promptPath),
      });
    }
  }
  return prompts;
};

export const listPiCommands = ({ home = os.homedir(), directory } = {}) => {
  const prompts = listPiPrompts({ home, directory }).map((prompt) => ({
    name: prompt.name,
    description: prompt.description,
    source: 'prompt',
    template: prompt.template,
    agent: 'pi',
    path: prompt.path,
    scope: prompt.scope,
  }));
  return [
    ...BUILTIN_COMMANDS.map((command) => ({ ...command, agent: 'pi' })),
    ...prompts,
  ];
};

export const readPiDefaults = (home = os.homedir()) => {
  const filePath = resolvePiDefaultsPath(home);
  if (!isFile(filePath)) {
    return { ...DEFAULT_PI_SETTINGS };
  }
  try {
    const parsed = JSON.parse(readText(filePath));
    const thinking = THINKING_LEVELS.includes(parsed?.thinking) ? parsed.thinking : DEFAULT_PI_SETTINGS.thinking;
    return {
      model: typeof parsed?.model === 'string' ? parsed.model : '',
      thinking,
      compaction: parsed?.compaction !== false,
      retry: parsed?.retry !== false,
    };
  } catch {
    return { ...DEFAULT_PI_SETTINGS };
  }
};

export const writePiDefaults = (home = os.homedir(), patch = {}) => {
  const current = readPiDefaults(home);
  const next = {
    ...current,
    ...(typeof patch.model === 'string' ? { model: patch.model } : {}),
    ...(THINKING_LEVELS.includes(patch.thinking) ? { thinking: patch.thinking } : {}),
    ...(typeof patch.compaction === 'boolean' ? { compaction: patch.compaction } : {}),
    ...(typeof patch.retry === 'boolean' ? { retry: patch.retry } : {}),
  };
  const filePath = resolvePiDefaultsPath(home);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(next, null, 2)}\n`);
  return next;
};

export const toConfigSkillsPayload = (skills) => ({
  skills,
  externalSkills: {
    claudeDisabled: false,
    allDisabled: false,
  },
});

const SAFE_COMMAND_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

export const isBuiltinCommandName = (name) => BUILTIN_COMMANDS.some((command) => command.name === name);

const sanitizeCommandName = (name) => {
  const value = typeof name === 'string' ? name.trim() : '';
  if (!SAFE_COMMAND_NAME.test(value)) {
    const error = new Error('Invalid command name');
    error.status = 400;
    throw error;
  }
  return value;
};

const promptFileForScope = ({ home = os.homedir(), directory, name, scope } = {}) => {
  if (scope === 'project') {
    if (!directory) {
      const error = new Error('Project commands need a directory');
      error.status = 400;
      throw error;
    }
    return path.join(directory, '.pi', 'prompts', `${name}.md`);
  }
  return path.join(resolvePiAgentDir(home), 'prompts', `${name}.md`);
};

export const writePiPrompt = ({
  home = os.homedir(),
  directory,
  name,
  description = '',
  template = '',
  scope = 'user',
} = {}) => {
  const commandName = sanitizeCommandName(name);
  if (isBuiltinCommandName(commandName)) {
    const error = new Error('Cannot overwrite a built-in Pi command');
    error.status = 400;
    throw error;
  }
  const filePath = promptFileForScope({ home, directory, name: commandName, scope });
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const desc = typeof description === 'string' ? description.trim() : '';
  const body = typeof template === 'string' ? template : '';
  const contents = desc
    ? `---\ndescription: ${desc.replace(/\n/g, ' ')}\n---\n${body}${body.endsWith('\n') ? '' : '\n'}`
    : `${body}${body.endsWith('\n') ? '' : '\n'}`;
  fs.writeFileSync(filePath, contents);
  return {
    name: commandName,
    description: desc || `/${commandName}`,
    source: 'prompt',
    template: body,
    agent: 'pi',
    path: filePath,
    scope: scope === 'project' ? 'project' : 'user',
  };
};

export const deletePiPrompt = ({ home = os.homedir(), directory, name } = {}) => {
  const commandName = sanitizeCommandName(name);
  if (isBuiltinCommandName(commandName)) {
    const error = new Error('Cannot delete a built-in Pi command');
    error.status = 400;
    throw error;
  }
  const candidates = [
    path.join(resolvePiAgentDir(home), 'prompts', `${commandName}.md`),
  ];
  if (directory) {
    candidates.unshift(path.join(directory, '.pi', 'prompts', `${commandName}.md`));
  }
  const existing = candidates.find((filePath) => isFile(filePath));
  if (!existing) {
    const error = new Error('Command not found');
    error.status = 404;
    throw error;
  }
  fs.unlinkSync(existing);
  return { deleted: true, name: commandName, path: existing };
};
