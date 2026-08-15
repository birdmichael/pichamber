import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  listPiCommands,
  listPiSkills,
  parseMarkdownFrontmatter,
  readPiDefaults,
  writePiDefaults,
} from './pi-resources.js';

const tempDirs = [];

const makeTemp = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-resources-'));
  tempDirs.push(dir);
  return dir;
};

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('pi-resources', () => {
  it('parses skill frontmatter', () => {
    const parsed = parseMarkdownFrontmatter('---\ndescription: Review diffs\n---\nLook at the change.');
    expect(parsed.attributes.description).toBe('Review diffs');
    expect(parsed.body).toBe('Look at the change.');
  });

  it('lists Pi skills and prompt commands from conventional directories', () => {
    const home = makeTemp();
    const project = makeTemp();
    fs.mkdirSync(path.join(home, '.pi', 'agent', 'skills', 'review'), { recursive: true });
    fs.writeFileSync(
      path.join(home, '.pi', 'agent', 'skills', 'review', 'SKILL.md'),
      '---\ndescription: Review code\n---\nReview carefully.\n',
    );
    fs.mkdirSync(path.join(home, '.pi', 'agent', 'prompts'), { recursive: true });
    fs.writeFileSync(path.join(home, '.pi', 'agent', 'prompts', 'ship.md'), 'Prepare the change for review.');
    fs.mkdirSync(path.join(project, '.pi', 'skills', 'local'), { recursive: true });
    fs.writeFileSync(path.join(project, '.pi', 'skills', 'local', 'SKILL.md'), '---\ndescription: Local skill\n---\n');

    const skills = listPiSkills({ home, directory: project });
    expect(skills.map((skill) => skill.name).sort()).toEqual(['local', 'review']);
    expect(skills.find((skill) => skill.name === 'review').scope).toBe('user');
    expect(skills.find((skill) => skill.name === 'local').scope).toBe('project');

    const commands = listPiCommands({ home, directory: project });
    expect(commands.some((command) => command.name === 'compact' && command.source === 'builtin')).toBe(true);
    expect(commands.some((command) => command.name === 'ship' && command.template.includes('Prepare the change'))).toBe(true);
  });

  it('reads and writes Pi defaults without touching auth.json', () => {
    const home = makeTemp();
    expect(readPiDefaults(home).thinking).toBe('medium');
    const saved = writePiDefaults(home, { model: 'bmlab/grok-4.6', thinking: 'high', compaction: false });
    expect(saved).toEqual({
      model: 'bmlab/grok-4.6',
      thinking: 'high',
      compaction: false,
      retry: true,
    });
    expect(readPiDefaults(home).model).toBe('bmlab/grok-4.6');
    expect(fs.existsSync(path.join(home, '.pi', 'agent', 'auth.json'))).toBe(false);
  });
});
