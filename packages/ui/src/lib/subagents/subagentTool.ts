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

const asTrimmed = (value: unknown): string => (
  typeof value === 'string' && value.trim() ? value.trim() : ''
);

const hasSubagentExecutionPayload = (value?: Record<string, unknown> | null): boolean => {
  if (!value) return false;
  if (asTrimmed(value.task) || asTrimmed(value.workflowScript)) return true;
  if (Array.isArray(value.tasks) && value.tasks.length > 0) return true;
  if (Array.isArray(value.chain) && value.chain.length > 0) return true;
  return false;
};

const readOutputRecord = (output?: unknown): Record<string, unknown> | null => {
  if (output && typeof output === 'object' && !Array.isArray(output)) {
    return output as Record<string, unknown>;
  }
  if (typeof output === 'string' && output.trim()) {
    try {
      const parsed = JSON.parse(output) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return null;
    }
  }
  return null;
};

export const isSubagentManagementCall = (
  input?: Record<string, unknown> | null,
  output?: unknown,
): boolean => {
  const parsed = readOutputRecord(output);
  const details = parsed?.details && typeof parsed.details === 'object' && !Array.isArray(parsed.details)
    ? parsed.details as Record<string, unknown>
    : parsed;
  if (hasSubagentExecutionPayload(input) || hasSubagentExecutionPayload(details)) return false;
  const mode = asTrimmed(input?.mode || details?.mode || parsed?.mode).toLowerCase();
  if (mode === 'management') return true;
  return Boolean(asTrimmed(input?.action || details?.action || parsed?.action));
};

export const shouldOfferSubagentChildOpen = ({
  childSessionId,
  input,
  output,
}: {
  childSessionId?: string | null;
  input?: Record<string, unknown> | null;
  output?: unknown;
}): boolean => Boolean(asTrimmed(childSessionId)) && !isSubagentManagementCall(input, output);

export const readSubagentChildSessionIdFromRuns = (
  runs: Array<{ runId?: string | null; toolCallId?: string | null; sessionID?: string | null }>,
  callID?: string | null,
): string | null => {
  const call = asTrimmed(callID);
  if (!call) return null;
  for (const run of Array.isArray(runs) ? runs : []) {
    const sessionID = asTrimmed(run?.sessionID);
    if (!sessionID) continue;
    if (asTrimmed(run.toolCallId) === call || asTrimmed(run.runId) === call) {
      return sessionID;
    }
  }
  return null;
};

export const readSubagentChildDirectoryFromRuns = (
  runs: Array<{ runId?: string | null; toolCallId?: string | null; directory?: string | null }>,
  callID?: string | null,
): string | null => {
  const call = asTrimmed(callID);
  if (!call) return null;
  for (const run of Array.isArray(runs) ? runs : []) {
    if (asTrimmed(run.toolCallId) === call || asTrimmed(run.runId) === call) {
      return asTrimmed(run.directory) || null;
    }
  }
  return null;
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
