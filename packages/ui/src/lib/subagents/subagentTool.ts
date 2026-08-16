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

const readSessionIdField = (value: unknown): string => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return '';
  const record = value as { sessionId?: unknown; childSessionId?: unknown; details?: unknown };
  if (typeof record.childSessionId === 'string' && record.childSessionId.trim()) {
    return record.childSessionId.trim();
  }
  if (typeof record.sessionId === 'string' && record.sessionId.trim()) {
    return record.sessionId.trim();
  }
  if (record.details && typeof record.details === 'object' && !Array.isArray(record.details)) {
    return readSessionIdField(record.details);
  }
  return '';
};

export const readSubagentChildSessionId = (
  input?: Record<string, unknown> | null,
  output?: unknown,
): string | null => {
  const fromInput = typeof input?.sessionId === 'string'
    ? input.sessionId.trim()
    : typeof input?.childSessionId === 'string'
      ? input.childSessionId.trim()
      : '';
  if (fromInput) return fromInput;
  if (typeof output === 'string' && output.trim()) {
    try {
      const id = readSessionIdField(JSON.parse(output));
      if (id) return id;
    } catch {
      return null;
    }
  }
  const fromOutput = readSessionIdField(output);
  return fromOutput || null;
};
