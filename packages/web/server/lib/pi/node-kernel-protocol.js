export const NODE_KERNEL_PROTOCOL = 1;

export const serializeKernelError = (error) => ({
  name: error?.name || 'Error',
  message: error?.message || String(error),
  status: Number.isInteger(error?.status) ? error.status : undefined,
  code: typeof error?.code === 'string' ? error.code : undefined,
  recovery: typeof error?.recovery === 'string' ? error.recovery : undefined,
});

export const restoreKernelError = (payload) => {
  const error = new Error(payload?.message || 'Node kernel request failed');
  if (payload?.name) error.name = payload.name;
  if (Number.isInteger(payload?.status)) error.status = payload.status;
  if (typeof payload?.code === 'string') error.code = payload.code;
  if (typeof payload?.recovery === 'string') error.recovery = payload.recovery;
  return error;
};

export const serializeSessionSnapshot = (session, extras = {}) => ({
  sessionId: session?.sessionId || extras.sessionId || '',
  sessionFile: typeof session?.sessionFile === 'string' ? session.sessionFile : extras.sessionFile,
  isStreaming: Boolean(session?.isStreaming),
  isCompacting: Boolean(session?.isCompacting),
  thinkingLevel: typeof session?.thinkingLevel === 'string' ? session.thinkingLevel : 'medium',
  currentModel: session?.currentModel || null,
  commands: typeof session?.getCommands === 'function' ? session.getCommands() : [],
  planModeState: typeof session?.getPlanModeState === 'function' ? session.getPlanModeState() : null,
  availableThinkingLevels: typeof session?.getAvailableThinkingLevels === 'function'
    ? session.getAvailableThinkingLevels()
    : [],
  contextUsage: typeof session?.getContextUsage === 'function' ? session.getContextUsage() : null,
  entries: typeof session?.sessionManager?.getEntries === 'function'
    ? session.sessionManager.getEntries()
    : [],
  toolNames: extras.toolNames || [],
});
