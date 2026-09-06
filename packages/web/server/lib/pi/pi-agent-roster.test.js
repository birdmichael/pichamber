import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { listPiSubagents, writePiSubagent } from './pi-agent-roster.js';

const roots = [];
const tempRoot = () => { const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pichamber-agent-roster-')); roots.push(root); return root; };
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

describe('Pi agent roster', () => {
  it('lists built-ins and reads user/project markdown', () => {
    const root = tempRoot(); const home = path.join(root, 'home'); const project = path.join(root, 'project'); fs.mkdirSync(path.join(home, 'agents'), { recursive: true }); fs.mkdirSync(path.join(project, '.pi', 'agents'), { recursive: true });
    fs.writeFileSync(path.join(home, 'agents', 'reviewer.md'), '---\ndescription: Check changes\nmodel: openai/gpt-5\nthinking: high\ncustom: keep\n---\n\nReview body');
    fs.writeFileSync(path.join(project, '.pi', 'agents', 'worker.md'), '---\ndescription: Project worker\n---\n\nWork here');
    const agents = listPiSubagents({ agentDir: home, directory: project });
    expect(agents.find((agent) => agent.name === 'reviewer')).toMatchObject({ scope: 'user', model: 'openai/gpt-5', thinking: 'high', body: 'Review body' });
    expect(agents.find((agent) => agent.name === 'worker')).toMatchObject({ scope: 'project' });
    expect(agents.find((agent) => agent.name === 'scout')).toMatchObject({ readOnly: true, scope: 'builtin' });
  });
  it('writes a new markdown file while retaining unknown frontmatter', () => {
    const root = tempRoot(); const home = path.join(root, 'home'); const project = path.join(root, 'project'); const saved = writePiSubagent({ agentDir: home, directory: project, name: 'custom', scope: 'user', frontmatter: { description: 'Custom', inheritSkills: true, tools: ['read'] }, body: 'Prompt' });
    expect(saved.name).toBe('custom'); expect(fs.readFileSync(path.join(home, 'agents', 'custom.md'), 'utf8')).toContain('inheritSkills: true');
  });
});
