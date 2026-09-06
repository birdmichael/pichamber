import fs from 'node:fs';
import path from 'node:path';
import yaml from 'yaml';

const BUILTIN_SUBAGENTS = [
  { name: 'edit', description: 'Make focused edits to the current workspace.' },
  { name: 'scout', description: 'Explore the workspace and report useful findings.' },
  { name: 'worker', description: 'Implement a focused task in the current workspace.' },
  { name: 'reviewer', description: 'Review changes and report risks or improvements.' },
  { name: 'researcher', description: 'Research a question and summarize the evidence.' },
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
const asAgent = ({ name, scope, filePath, source, readOnly = false, description }) => {
  const parsed = parseAgentMarkdown(source); const frontmatter = parsed.frontmatter || {};
  return { id: name, name, description: typeof frontmatter.description === 'string' ? frontmatter.description : (description || ''), model: typeof frontmatter.model === 'string' ? frontmatter.model.trim() : '', thinking: typeof frontmatter.thinking === 'string' ? frontmatter.thinking.trim() : '', tools: frontmatter.tools ?? frontmatter.capabilities ?? [], scope, readOnly, path: filePath || null, frontmatter, body: parsed.body };
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
