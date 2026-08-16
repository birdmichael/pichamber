import { createEventId, createMessageId, createPartId } from './ids.js';
import { toPiImageContent } from './session-transfer.js';

const toNonNegativeNumber = (value) => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return 0;
  }
  return value;
};

/** Map Pi assistant `usage` onto the OpenCode message token/cost shape. */
export const mapPiUsageToOpenCodeTokens = (usage) => {
  if (!usage || typeof usage !== 'object') {
    return {
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    };
  }
  const costValue = usage.cost;
  const cost = typeof costValue === 'number'
    ? toNonNegativeNumber(costValue)
    : toNonNegativeNumber(costValue?.total);
  return {
    cost,
    tokens: {
      input: toNonNegativeNumber(usage.input),
      output: toNonNegativeNumber(usage.output),
      reasoning: toNonNegativeNumber(usage.reasoning),
      cache: {
        read: toNonNegativeNumber(usage.cacheRead ?? usage.cache?.read),
        write: toNonNegativeNumber(usage.cacheWrite ?? usage.cache?.write),
      },
    },
  };
};

const toolText = (value) => {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === 'string') return item;
        if (item && typeof item === 'object' && typeof item.text === 'string') return item.text;
        return '';
      })
      .filter(Boolean)
      .join('');
  }
  if (typeof value === 'object') {
    if (typeof value.text === 'string') return value.text;
    if (Array.isArray(value.content)) return toolText(value.content);
  }
  return '';
};

export const createOpenCodeEvent = (type, properties, { id, now } = {}) => ({
  id: id || createEventId(),
  type,
  properties,
  ...(now ? { timestamp: now } : {}),
});

export const createEventTranslator = ({
  sessionID,
  directory,
  createMessageId: nextMessageId = createMessageId,
  createPartId: nextPartId = createPartId,
  createEventId: nextEventId = createEventId,
  now = () => Date.now(),
} = {}) => {
  const textParts = new Map();
  const reasoningParts = new Map();
  const toolParts = new Map();
  let assistantMessageID = null;
  let assistantCreatedAt = null;
  let assistantParentID = null;
  let userMessageID = null;
  let agent = 'pi';
  let model = undefined;
  let lastUsage = undefined;

  const event = (type, properties) => createOpenCodeEvent(type, properties, {
    id: nextEventId(),
    now: now(),
  });

  const setAssistantMessage = (messageID) => {
    assistantMessageID = messageID;
    if (assistantCreatedAt == null) assistantCreatedAt = now();
    if (!assistantParentID && userMessageID) assistantParentID = userMessageID;
  };

  const setUserMessage = (messageID, extras = {}) => {
    userMessageID = messageID;
    if (typeof extras.agent === 'string' && extras.agent.trim()) {
      agent = extras.agent;
    }
    if (extras.model) {
      model = extras.model;
    }
  };

  const beginAssistantMessage = (messageID) => {
    assistantMessageID = messageID || nextMessageId();
    assistantCreatedAt = now();
    assistantParentID = userMessageID;
    textParts.clear();
    reasoningParts.clear();
    toolParts.clear();
    lastUsage = undefined;
    return assistantMessageID;
  };

  const ensureAssistantMessage = () => {
    if (!assistantMessageID) {
      beginAssistantMessage();
    }
    return assistantMessageID;
  };

  const assistantInfo = ({ completed = false, model: modelOverride, usage } = {}) => {
    ensureAssistantMessage();
    const created = assistantCreatedAt ?? now();
    const resolvedModel = modelOverride || model;
    const modelID = resolvedModel?.modelID || resolvedModel?.id || 'pi';
    const providerID = resolvedModel?.providerID || resolvedModel?.provider || 'pi';
    const cwd = directory || '';
    if (usage) lastUsage = usage;
    const mapped = mapPiUsageToOpenCodeTokens(usage || lastUsage);
    return {
      id: assistantMessageID,
      sessionID,
      role: 'assistant',
      // OpenCode chat turns group assistants by parentID === user message id.
      // Without this the UI drops the reply (streaming and on reload).
      parentID: assistantParentID || userMessageID || '',
      modelID,
      providerID,
      mode: agent || 'pi',
      agent,
      path: { cwd, root: cwd },
      cost: mapped.cost,
      tokens: mapped.tokens,
      time: completed ? { created, completed: now() } : { created },
      ...(resolvedModel ? { model: resolvedModel } : {}),
      ...(completed ? { finish: 'stop' } : {}),
    };
  };

  // SDK EventMessageUpdated.properties requires top-level sessionID + info.
  // EventMessagePartUpdated.properties requires sessionID + part + time.
  const messageUpdated = (info) => event('message.updated', { sessionID, info });
  const partUpdated = (part) => event('message.part.updated', { sessionID, part, time: now() });

  const textPart = (partID, text = '') => ({
    id: partID,
    sessionID,
    messageID: assistantMessageID,
    type: 'text',
    text,
  });

  const reasoningPart = (partID, text = '') => ({
    id: partID,
    sessionID,
    messageID: assistantMessageID,
    type: 'reasoning',
    text,
  });

  const toolPart = (partID, { callID, tool, status, input, output, error, metadata }) => ({
    id: partID,
    sessionID,
    messageID: assistantMessageID,
    type: 'tool',
    callID,
    tool,
    state: {
      status,
      input: input ?? {},
      ...(output !== undefined ? { output } : {}),
      ...(error ? { error } : {}),
      ...(metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? { metadata } : {}),
      time: { start: now(), ...(status === 'completed' || status === 'error' ? { end: now() } : {}) },
    },
  });

  const translateAssistantDelta = (delta) => {
    if (!delta || typeof delta !== 'object') return [];
    const contentIndex = typeof delta.contentIndex === 'number' ? delta.contentIndex : 0;

    switch (delta.type) {
      case 'text_start': {
        ensureAssistantMessage();
        const partID = nextPartId();
        textParts.set(contentIndex, partID);
        return [
          messageUpdated(assistantInfo()),
          partUpdated(textPart(partID, '')),
        ];
      }
      case 'text_delta': {
        ensureAssistantMessage();
        let partID = textParts.get(contentIndex);
        const created = [];
        if (!partID) {
          partID = nextPartId();
          textParts.set(contentIndex, partID);
          created.push(messageUpdated(assistantInfo()));
          created.push(partUpdated(textPart(partID, '')));
        }
        created.push(event('message.part.delta', {
          sessionID,
          messageID: assistantMessageID,
          partID,
          field: 'text',
          delta: typeof delta.delta === 'string' ? delta.delta : '',
        }));
        return created;
      }
      case 'text_end': {
        const partID = textParts.get(contentIndex);
        if (!partID || !assistantMessageID) return [];
        const text = typeof delta.content === 'string' ? delta.content : undefined;
        if (text === undefined) return [];
        return [partUpdated(textPart(partID, text))];
      }
      case 'thinking_start': {
        ensureAssistantMessage();
        const partID = nextPartId();
        reasoningParts.set(contentIndex, partID);
        return [
          messageUpdated(assistantInfo()),
          partUpdated(reasoningPart(partID, '')),
        ];
      }
      case 'thinking_delta': {
        ensureAssistantMessage();
        let partID = reasoningParts.get(contentIndex);
        const created = [];
        if (!partID) {
          partID = nextPartId();
          reasoningParts.set(contentIndex, partID);
          created.push(messageUpdated(assistantInfo()));
          created.push(partUpdated(reasoningPart(partID, '')));
        }
        created.push(event('message.part.delta', {
          sessionID,
          messageID: assistantMessageID,
          partID,
          field: 'text',
          delta: typeof delta.delta === 'string' ? delta.delta : '',
        }));
        return created;
      }
      case 'thinking_end': {
        const partID = reasoningParts.get(contentIndex);
        if (!partID || !assistantMessageID) return [];
        const text = typeof delta.content === 'string'
          ? delta.content
          : typeof delta.thinking === 'string'
            ? delta.thinking
            : undefined;
        if (text === undefined) return [];
        return [partUpdated(reasoningPart(partID, text))];
      }
      case 'toolcall_start': {
        ensureAssistantMessage();
        const callID = delta.toolCall?.id || delta.id || nextPartId();
        const tool = delta.toolCall?.name || delta.name || 'tool';
        const partID = nextPartId();
        toolParts.set(callID, partID);
        return [
          messageUpdated(assistantInfo()),
          partUpdated(toolPart(partID, { callID, tool, status: 'pending', input: delta.toolCall?.arguments || {} })),
        ];
      }
      case 'toolcall_end': {
        const call = delta.toolCall || {};
        const callID = call.id || delta.id;
        const partID = callID ? toolParts.get(callID) : null;
        if (!partID || !assistantMessageID) return [];
        return [partUpdated(toolPart(partID, {
            callID,
            tool: call.name || 'tool',
            status: 'pending',
            input: call.arguments || {},
          }))];
      }
      default:
        return [];
    }
  };

  const translate = (piEvent) => {
    if (!piEvent || typeof piEvent !== 'object') return [];
    const type = piEvent.type;

    switch (type) {
      case 'agent_start':
        return [event('session.status', { sessionID, status: { type: 'busy' } })];

      case 'agent_settled':
        return [
          event('session.status', { sessionID, status: { type: 'idle' } }),
          event('session.idle', { sessionID }),
        ];

      case 'agent_end':
        // Idle is agent_settled, not agent_end — retries/compaction may still follow.
        return [];

      case 'auto_retry_start':
        return [event('session.status', {
          sessionID,
          status: {
            type: 'retry',
            attempt: Number(piEvent.attempt) || 1,
            message: typeof piEvent.errorMessage === 'string' ? piEvent.errorMessage : 'retrying',
            next: now() + (Number(piEvent.delayMs) || 0),
          },
        })];

      case 'message_start': {
        const message = piEvent.message;
        const role = message?.role;
        if (role === 'user') {
          // Facade promptAsync already persisted the user bubble. Pi also
          // emits message_start with the same text; echoing it adds a second
          // text part on the same (or a new) user message.
          if (userMessageID) {
            return [];
          }
          userMessageID = message.id || nextMessageId();
          const text = typeof message.content === 'string'
            ? message.content
            : Array.isArray(message.content)
              ? message.content.filter((block) => block?.type === 'text').map((block) => block.text).join('')
              : '';
          const partID = nextPartId();
          return [
            messageUpdated({
              id: userMessageID,
              sessionID,
              role: 'user',
              time: { created: now() },
            }),
            partUpdated({
              id: partID,
              sessionID,
              messageID: userMessageID,
              type: 'text',
              text,
            }),
          ];
        }
        if (message?.model) {
          model = message.model;
        }
        beginAssistantMessage(message?.id && typeof message.id === 'string' ? message.id : undefined);
        return [messageUpdated(assistantInfo({ usage: message?.usage }))];
      }

      case 'message_update':
        if (piEvent.message?.usage) {
          lastUsage = piEvent.message.usage;
        }
        if (piEvent.message?.model) {
          model = piEvent.message.model;
        }
        return translateAssistantDelta(piEvent.assistantMessageEvent);

      case 'message_end': {
        if (!assistantMessageID) return [];
        if (piEvent.message?.model) {
          model = piEvent.message.model;
        }
        const events = [messageUpdated(assistantInfo({
          completed: true,
          usage: piEvent.message?.usage,
        }))];
        return events;
      }

      case 'tool_execution_start': {
        ensureAssistantMessage();
        const callID = piEvent.toolCallId;
        let partID = toolParts.get(callID);
        const created = [];
        if (!partID) {
          partID = nextPartId();
          toolParts.set(callID, partID);
          created.push(messageUpdated(assistantInfo()));
        }
        created.push(partUpdated(toolPart(partID, {
            callID,
            tool: piEvent.toolName || 'tool',
            status: 'running',
            input: piEvent.args || {},
          })));
        return created;
      }

      case 'tool_execution_update': {
        const callID = piEvent.toolCallId;
        const partID = toolParts.get(callID);
        if (!partID || !assistantMessageID) return [];
        const output = toolText(piEvent.partialResult?.content ?? piEvent.partialResult);
        return [partUpdated(toolPart(partID, {
            callID,
            tool: piEvent.toolName || 'tool',
            status: 'running',
            input: piEvent.args || {},
            output,
          }))];
      }

      case 'tool_execution_end': {
        const callID = piEvent.toolCallId;
        const partID = toolParts.get(callID);
        if (!partID || !assistantMessageID) return [];
        const output = toolText(piEvent.result?.content ?? piEvent.result);
        const metadata = piEvent.result?.details && typeof piEvent.result.details === 'object'
          ? piEvent.result.details
          : undefined;
        return [partUpdated(toolPart(partID, {
            callID,
            tool: piEvent.toolName || 'tool',
            status: piEvent.isError ? 'error' : 'completed',
            input: piEvent.args || {},
            output,
            error: piEvent.isError ? output || 'tool error' : undefined,
            metadata,
          }))];
      }

      case 'compaction_start':
        return [
          event('session.status', { sessionID, status: { type: 'busy' } }),
          event('session.compact', { sessionID, status: 'start' }),
        ];

      case 'compaction_end':
        return [
          event('session.compact', { sessionID, status: 'end' }),
        ];

      default:
        return [];
    }
  };

  return {
    translate,
    setAssistantMessage,
    setUserMessage,
    get assistantMessageID() {
      return assistantMessageID;
    },
    get userMessageID() {
      return userMessageID;
    },
    directory,
  };
};

export const extractPromptText = (parts) => {
  if (!Array.isArray(parts)) return '';
  return parts
    .filter((part) => part && part.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text)
    .join('\n')
    .trim();
};

export const extractPromptImages = (parts) => {
  if (!Array.isArray(parts)) return [];
  const images = [];
  for (const part of parts) {
    const image = toPiImageContent(part);
    if (image) images.push(image);
  }
  return images;
};
