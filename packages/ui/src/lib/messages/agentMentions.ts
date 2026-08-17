import type { Agent } from "@opencode-ai/sdk/v2";

interface AgentMentionSource {
  value: string;
  start: number;
  end: number;
}

interface ParsedAgentMention {
  name: string;
  source?: AgentMentionSource;
}

export interface ParsedAgentResult {
  sanitizedText: string;
  mention: ParsedAgentMention | null;
}

interface ParseAgentMentionsOptions {
  /** Pi has one built-in agent. Leftover OpenCode `@agent` routing stays off. */
  isPiKernel?: boolean;
}

const isWordBoundaryChar = (char: string | null): boolean => {
  if (!char) {
    return true;
  }
  return /(\s|\(|\)|\[|\]|\{|\}|"|'|`|,|\.|;|:)/.test(char);
};

/**
 * OpenCode `@agent` mentions switch personality. Pi has no extra agents, so
 * that routing is a leftover no-op even if a stale list still has `build` /
 * `plan` / custom names.
 */
export function shouldRouteComposerAgentMentions(isPiKernel: boolean): boolean {
  return !isPiKernel;
}

/**
 * Agents the `@` picker may offer. On Pi the list is empty so leftover
 * OpenCode personalities cannot appear. OpenCode still offers non-primary
 * agents only.
 */
export function getComposerMentionableAgents<T extends { mode?: string | null }>(
  agents: readonly T[],
  options: { isPiKernel: boolean },
): T[] {
  if (!shouldRouteComposerAgentMentions(options.isPiKernel)) {
    return [];
  }
  return agents.filter((agent) => agent.mode && agent.mode !== "primary");
}

/**
 * Names the composer highlights as `@agent` tokens. Empty on Pi so leftover
 * OpenCode names stay plain prose.
 */
export function getComposerKnownAgentNames(
  agents: ReadonlyArray<{ name: string }>,
  options: { isPiKernel: boolean },
): Set<string> {
  if (!shouldRouteComposerAgentMentions(options.isPiKernel)) {
    return new Set();
  }
  return new Set(agents.map((agent) => agent.name.toLowerCase()));
}

export const parseAgentMentions = (
  rawText: string,
  agents: Agent[],
  options: ParseAgentMentionsOptions = {},
): ParsedAgentResult => {
  if (typeof rawText !== "string" || rawText.length === 0) {
    return { sanitizedText: rawText, mention: null };
  }

  if (options.isPiKernel) {
    return { sanitizedText: rawText, mention: null };
  }

  const mentionableAgents = getComposerMentionableAgents(agents, { isPiKernel: false });
  if (mentionableAgents.length === 0 || !rawText.includes("@")) {
    return { sanitizedText: rawText, mention: null };
  }

  let firstMention: ParsedAgentMention | null = null;

  for (const agent of mentionableAgents) {
    const escapedAgentName = agent.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(`@${escapedAgentName}\\b`, "gi");
    let match: RegExpExecArray | null;

    while ((match = pattern.exec(rawText)) !== null) {
      const start = match.index;
      const end = start + match[0].length;
      const charBefore = start > 0 ? rawText[start - 1] : null;

      if (!isWordBoundaryChar(charBefore)) {
        continue;
      }

      const mention: ParsedAgentMention = {
        name: agent.name,
        source: {
          value: match[0],
          start,
          end,
        },
      };

      if (!firstMention) {
        firstMention = mention;
      }
    }
  }

  if (!firstMention) {
    return { sanitizedText: rawText, mention: null };
  }

  return {
    sanitizedText: rawText,
    mention: firstMention,
  };
};
