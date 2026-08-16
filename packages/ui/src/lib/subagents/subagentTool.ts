export const shouldRenderDedicatedSubagentCard = ({
  tool,
  isPiKernel,
  subagentsSlotActive,
}: {
  tool: string;
  isPiKernel: boolean;
  subagentsSlotActive: boolean;
}): boolean => {
  const name = tool.trim().toLowerCase();
  if (isPiKernel) {
    return subagentsSlotActive && name === 'subagent';
  }
  return name === 'task';
};

export const shouldRenderOpenCodeSubtaskChrome = ({
  isPiKernel,
  subagentsSlotActive,
}: {
  isPiKernel: boolean;
  subagentsSlotActive: boolean;
}): boolean => !isPiKernel || subagentsSlotActive;

export const shouldShowPiFromSubagentLabel = ({
  isPiKernel,
  subagentsSlotActive,
}: {
  isPiKernel: boolean;
  subagentsSlotActive: boolean;
}): boolean => !isPiKernel || subagentsSlotActive;

export const readSubagentCardAgent = (input?: Record<string, unknown> | null): string => {
  const agent = typeof input?.agent === 'string' ? input.agent.trim() : '';
  if (agent) return agent;
  const type = typeof input?.subagent_type === 'string' ? input.subagent_type.trim() : '';
  return type || 'subagent';
};

export const readSubagentChildSessionId = (
  input?: Record<string, unknown> | null,
  output?: unknown,
): string | null => {
  const fromInput = typeof input?.sessionId === 'string' ? input.sessionId.trim() : '';
  if (fromInput) return fromInput;
  if (typeof output === 'string' && output.trim()) {
    try {
      const parsed = JSON.parse(output) as { details?: { sessionId?: unknown; childSessionId?: unknown }; sessionId?: unknown };
      const details = parsed?.details && typeof parsed.details === 'object' ? parsed.details : parsed;
      const id = typeof details?.childSessionId === 'string'
        ? details.childSessionId.trim()
        : (typeof details?.sessionId === 'string' ? details.sessionId.trim() : '');
      if (id) return id;
    } catch {
    }
  }
  if (output && typeof output === 'object' && !Array.isArray(output)) {
    const record = output as { sessionId?: unknown; childSessionId?: unknown; details?: { sessionId?: unknown } };
    const id = typeof record.childSessionId === 'string'
      ? record.childSessionId.trim()
      : (typeof record.sessionId === 'string'
        ? record.sessionId.trim()
        : (typeof record.details?.sessionId === 'string' ? record.details.sessionId.trim() : ''));
    if (id) return id;
  }
  return null;
};
