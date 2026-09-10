/** Built-in checklist entries always offered in the Pi Agents tools grid. */
export const PI_BASE_TOOLS = [
  'read',
  'write',
  'edit',
  'bash',
  'grep',
  'find',
  'ls',
  'question',
  'todo',
] as const;

/**
 * Tools checklist for the Pi Agents editor: base tools plus any extras the
 * agent already declares (e.g. researcher web_* tools, contact_supervisor).
 * Preserves base order, then appends unknown agent tools in given order.
 */
export function mergePiToolsChecklist(agentTools: readonly string[]): string[] {
  const seen = new Set<string>();
  const merged: string[] = [];

  for (const tool of PI_BASE_TOOLS) {
    if (seen.has(tool)) continue;
    seen.add(tool);
    merged.push(tool);
  }

  for (const tool of agentTools) {
    const name = typeof tool === 'string' ? tool.trim() : '';
    if (!name || seen.has(name)) continue;
    seen.add(name);
    merged.push(name);
  }

  return merged;
}
