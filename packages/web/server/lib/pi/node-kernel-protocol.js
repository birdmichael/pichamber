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

export const serializeSessionCommands = (commands) => {
  if (!Array.isArray(commands)) return [];
  return commands.flatMap((command) => {
    const rawName = typeof command?.name === 'string' && command.name.trim()
      ? command.name
      : (typeof command?.invocationName === 'string' ? command.invocationName : '');
    const name = rawName.trim().replace(/^\//, '');
    if (!name) return [];
    const invocation = typeof command?.invocationName === 'string' && command.invocationName.trim()
      ? command.invocationName.trim().replace(/^\//, '')
      : '';
    const entry = {
      name,
      description: typeof command?.description === 'string' ? command.description : '',
      source: command?.source || 'extension',
    };
    if (invocation && invocation !== name) entry.invocationName = invocation;
    return [entry];
  });
};

/** Real AgentSession has no getCommands(); live names live on extensionRunner. */
export const listSessionCommands = (session) => {
  if (typeof session?.getCommands === 'function') {
    try {
      const commands = session.getCommands();
      if (Array.isArray(commands) && commands.length > 0) {
        return serializeSessionCommands(commands);
      }
    } catch {
    }
  }
  const registered = session?.extensionRunner?.getRegisteredCommands?.();
  if (Array.isArray(registered) && registered.length > 0) {
    return serializeSessionCommands(registered);
  }
  return [];
};

export const serializeSessionSnapshot = (session, extras = {}) => ({
  sessionId: session?.sessionId || extras.sessionId || '',
  sessionFile: typeof session?.sessionFile === 'string' ? session.sessionFile : extras.sessionFile,
  isStreaming: Boolean(session?.isStreaming),
  isCompacting: Boolean(session?.isCompacting),
  thinkingLevel: typeof session?.thinkingLevel === 'string' ? session.thinkingLevel : 'medium',
  currentModel: session?.currentModel || null,
  commands: listSessionCommands(session),
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
