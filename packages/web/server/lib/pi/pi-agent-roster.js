import fs from 'node:fs';
import path from 'node:path';
import yaml from 'yaml';

const BUILTIN_SUBAGENTS = [
  { name: 'edit', description: 'Focused implementation agent for small, bounded edits', tools: ['read', 'grep', 'find', 'ls', 'bash', 'edit', 'write', 'contact_supervisor'], systemPromptMode: 'replace', inheritProjectContext: true, inheritSkills: false, body: 'Make the smallest correct change requested and verify it.' },
  { name: 'scout', description: 'Fast codebase recon that returns compressed context for handoff', tools: ['read', 'grep', 'find', 'ls', 'bash', 'write'], thinking: 'low', systemPromptMode: 'replace', inheritProjectContext: true, inheritSkills: false, output: 'context.md', defaultProgress: true, body: 'Explore the codebase and return concise evidence-backed context.' },
  { name: 'worker', description: 'Implementation agent for normal tasks and approved oracle handoffs', tools: ['read', 'grep', 'find', 'ls', 'bash', 'edit', 'write', 'contact_supervisor'], thinking: 'high', systemPromptMode: 'replace', inheritProjectContext: true, inheritSkills: false, defaultContext: 'fork', defaultReads: ['context.md', 'plan.md'], defaultProgress: true, body: 'Implement the assigned task with narrow edits and verify the result.' },
  { name: 'reviewer', description: 'Versatile review specialist for code diffs, plans, proposed solutions, codebase health, and PR/issue validation', tools: ['read', 'grep', 'find', 'ls'], thinking: 'high', systemPromptMode: 'replace', inheritProjectContext: true, inheritSkills: false, body: 'Review with evidence and report concrete findings without modifying code.' },
  { name: 'researcher', description: 'Autonomous web researcher — searches, evaluates, and synthesizes a focused research brief', tools: ['read', 'write', 'web_search', 'fetch_content', 'get_search_content'], thinking: 'medium', systemPromptMode: 'replace', inheritProjectContext: true, inheritSkills: false, output: 'research.md', defaultProgress: true, body: 'Run focused web research and produce a concise, well-sourced brief.' },
];
const isDirectory = (v) => { try { return fs.statSync(v).isDirectory(); } catch { return false; } };
const isFile = (v) => { try { return fs.statSync(v).isFile(); } catch { return false; } };
const safeAgentName = (value) => {
  const name = typeof value === 'string' ? value.trim() : '';
  if (!name || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(name) || name.length > 96) throw Object.assign(new Error('Invalid agent name'), { status: 400 });
  return name;
};
const parseAgentMarkdown = (source) => {
  const match = String(source || '').match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/);
  if (!match) return { frontmatter: {}, body: String(source || '').trim() };
  let frontmatter = {};
  try { const parsed = yaml.parse(match[1]); if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) frontmatter = parsed; } catch {}
  return { frontmatter, body: match[2].trim() };
};
const asAgent = ({ name, scope, filePath, source, readOnly = false, description, ...builtin }) => {
  const parsed = parseAgentMarkdown(source); const frontmatter = source ? parsed.frontmatter || {} : { name, ...builtin, description };
  return { id: name, name, description: typeof frontmatter.description === 'string' ? frontmatter.description : (description || ''), model: typeof frontmatter.model === 'string' ? frontmatter.model.trim() : '', thinking: typeof frontmatter.thinking === 'string' ? frontmatter.thinking.trim() : '', tools: frontmatter.tools ?? frontmatter.capabilities ?? [], scope, readOnly, path: filePath || null, frontmatter, body: source ? parsed.body : (builtin.body || '') };
};
const readDirectoryAgents = (root, scope) => {
  if (!isDirectory(root)) return []; let entries = [];
  try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { return []; }
  return entries.filter((entry) => entry.isFile() && entry.name.endsWith(".md")).map((entry) => {
    const filePath = path.join(root, entry.name); let source = "";
    try { source = fs.readFileSync(filePath, "utf8"); } catch { return null; }
    return asAgent({ name: entry.name.slice(0, -3), scope, filePath, source });
  }).filter(Boolean);
};
export const listPiSubagents = ({ agentDir, directory } = {}) => {
  const userAgents = readDirectoryAgents(path.join(agentDir || "", "agents"), "user");
  const projectAgents = readDirectoryAgents(path.join(directory || "", ".pi", "agents"), "project");
  const configuredNames = new Set([...userAgents, ...projectAgents].map((agent) => agent.name));
  const builtins = BUILTIN_SUBAGENTS.filter((agent) => !configuredNames.has(agent.name)).map((agent) => asAgent({ ...agent, scope: "builtin", readOnly: true }));
  return [...projectAgents, ...userAgents, ...builtins].sort((a, b) => a.readOnly !== b.readOnly ? (a.readOnly ? 1 : -1) : a.name.localeCompare(b.name));
};
export const getPiSubagent = ({ agentDir, directory, name } = {}) => { const safeName = safeAgentName(name); return listPiSubagents({ agentDir, directory }).find((agent) => agent.name === safeName) || null; };
const serializeAgentMarkdown = ({ frontmatter, body }) => '---\n' + yaml.stringify(frontmatter) + '---\n\n' + String(body || '').trim() + '\n';
export const writePiSubagent = ({ agentDir, directory, name, scope = 'user', frontmatter = {}, body = '' } = {}) => {
  const safeName = safeAgentName(name); const targetScope = scope === "project" ? "project" : "user";
  const root = targetScope === "project" ? path.join(directory || "", ".pi", "agents") : path.join(agentDir || "", "agents");
  if (!root || root === "agents" || root.endsWith(path.sep + ".pi" + path.sep + "agents")) throw Object.assign(new Error("Agent directory is unavailable"), { status: 400 });
  fs.mkdirSync(root, { recursive: true }); const target = path.join(root, safeName + ".md");
  const attributes = frontmatter && typeof frontmatter === "object" && !Array.isArray(frontmatter) ? { ...frontmatter, name: safeName } : { name: safeName };
  fs.writeFileSync(target, serializeAgentMarkdown({ frontmatter: attributes, body }), "utf8");
  return asAgent({ name: safeName, scope: targetScope, filePath: target, source: fs.readFileSync(target, "utf8") });
};
export const deletePiSubagent = ({ agentDir, directory, name, scope = 'user' } = {}) => {
  const safeName = safeAgentName(name); const root = scope === "project" ? path.join(directory || "", ".pi", "agents") : path.join(agentDir || "", "agents"); const target = path.join(root, safeName + ".md");
  if (!isFile(target)) throw Object.assign(new Error("Agent not found"), { status: 404 }); fs.rmSync(target); return { ok: true, name: safeName, scope };
};
