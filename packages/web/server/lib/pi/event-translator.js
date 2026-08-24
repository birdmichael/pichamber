import { createEventId, createMessageId, createPartId } from './ids.js';
import {
  mapPiUsageToOpenCodeTokens,
  resolveUsableFacadeModel,
  toPiImageContent,
  usageHasRecordedNumbers,
} from './session-transfer.js';

export { mapPiUsageToOpenCodeTokens, resolveUsableFacadeModel } from './session-transfer.js';

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
  fallbackModel,
} = {}) => {
  const textParts = new Map();
  const reasoningParts = new Map();
  const toolParts = new Map();
  const toolStartTimes = new Map();
  let assistantMessageID = null;
  let assistantCreatedAt = null;
  let assistantParentID = null;
  let userMessageID = null;
  let agent = 'pi';
  let model = undefined;
  let lastUsage = undefined;
  let resolvedFallback = resolveUsableFacadeModel(fallbackModel);

  const event = (type, properties) => createOpenCodeEvent(type, properties, {
    id: nextEventId(),
    now: now(),
  });

  const setAssistantMessage = (messageID) => {
    assistantMessageID = messageID;
    if (assistantCreatedAt == null) assistantCreatedAt = now();
    if (!assistantParentID && userMessageID) assistantParentID = userMessageID;
  };

  const setFallbackModel = (next) => {
    resolvedFallback = resolveUsableFacadeModel(next) || resolvedFallback;
  };

  const setUserMessage = (messageID, extras = {}) => {
    userMessageID = messageID;
    if (typeof extras.agent === 'string' && extras.agent.trim()) {
      agent = extras.agent;
    }
    const nextModel = resolveUsableFacadeModel(extras.model);
    if (nextModel) {
      model = nextModel;
      resolvedFallback = nextModel;
    } else if (extras.model) {
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
    toolStartTimes.clear();
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
    const usable = resolveUsableFacadeModel(modelOverride, model, resolvedFallback);
    const cwd = directory || '';
    if (usageHasRecordedNumbers(usage)) lastUsage = usage;
    const recordedUsage = usageHasRecordedNumbers(usage) ? usage : lastUsage;
    const mapped = usageHasRecordedNumbers(recordedUsage)
      ? mapPiUsageToOpenCodeTokens(recordedUsage)
      : null;
    return {
      id: assistantMessageID,
      sessionID,
      role: 'assistant',
      // OpenCode chat turns group assistants by parentID === user message id.
      // Without this the UI drops the reply (streaming and on reload).
      parentID: assistantParentID || userMessageID || '',
      ...(usable ? {
        modelID: usable.modelID,
        providerID: usable.providerID,
        model: usable.model,
      } : {}),
      mode: agent || 'pi',
      agent,
      path: { cwd, root: cwd },
      ...(mapped ? { cost: mapped.cost, tokens: mapped.tokens } : {}),
      time: completed ? { created, completed: now() } : { created },
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

  const toolPart = (partID, { callID, tool, status, input, output, error, metadata }) => {
    const startedAt = toolStartTimes.get(callID) ?? now();
    if (!toolStartTimes.has(callID)) toolStartTimes.set(callID, startedAt);
    const isDone = status === 'completed' || status === 'error';
    const endedAt = isDone ? now() : undefined;
    const duration = isDone ? Math.max(0, endedAt - startedAt) : undefined;
    const details = metadata && typeof metadata === 'object' && !Array.isArray(metadata)
      ? { ...metadata }
      : undefined;
    if (details && duration !== undefined && typeof details.duration !== 'number' && typeof details.durationMs !== 'number') {
      details.duration = duration;
    }
    return {
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
        ...(details ? { metadata: details } : {}),
        time: { start: startedAt, ...(endedAt !== undefined ? { end: endedAt, duration } : {}) },
      },
    };
  };

  const isToolCallBlock = (block) => (
    Boolean(block && typeof block === 'object' && (
      block.type === 'toolCall'
      || (block.type == null && (typeof block.id === 'string' || typeof block.name === 'string'))
    ))
  );

  const readToolCall = (delta, message) => {
    if (delta?.toolCall && typeof delta.toolCall === 'object') return delta.toolCall;
    const contentIndex = typeof delta?.contentIndex === 'number' ? delta.contentIndex : 0;
    const fromPartial = delta?.partial?.content?.[contentIndex];
    if (isToolCallBlock(fromPartial)) return fromPartial;
    const fromMessage = message?.content?.[contentIndex];
    if (isToolCallBlock(fromMessage)) return fromMessage;
    return null;
  };

  const toolCallIdentity = (delta, message) => {
    const call = readToolCall(delta, message);
    const callID = (typeof call?.id === 'string' && call.id)
      || (typeof delta?.id === 'string' && delta.id)
      || '';
    const tool = (typeof call?.name === 'string' && call.name)
      || (typeof delta?.name === 'string' && delta.name)
      || '';
    return { call, callID, tool };
  };

  const translateAssistantDelta = (delta, message) => {
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
        // Pi's live toolcall_start is { contentIndex, partial? }. It does not
        // carry toolCall/id/name. Inventing a part named "tool" with a generated
        // call id leaves an empty Tool row that never joins tool_execution_*.
        const { call, callID, tool } = toolCallIdentity(delta, message);
        if (!callID) {
          return [messageUpdated(assistantInfo())];
        }
        let partID = toolParts.get(callID);
        const created = [];
        if (!partID) {
          partID = nextPartId();
          toolParts.set(callID, partID);
          created.push(messageUpdated(assistantInfo()));
        }
        created.push(partUpdated(toolPart(partID, {
          callID,
          tool: tool || 'tool',
          status: 'pending',
          input: call?.arguments || {},
        })));
        return created;
      }
      case 'toolcall_end': {
        const { call, callID, tool } = toolCallIdentity(delta, message);
        if (!callID || !assistantMessageID) return [];
        let partID = toolParts.get(callID);
        const created = [];
        if (!partID) {
          partID = nextPartId();
          toolParts.set(callID, partID);
          created.push(messageUpdated(assistantInfo()));
        }
        created.push(partUpdated(toolPart(partID, {
          callID,
          tool: tool || 'tool',
          status: 'pending',
          input: call?.arguments || {},
        })));
        return created;
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
        const startedModel = resolveUsableFacadeModel(message);
        if (startedModel) {
          model = startedModel;
        } else if (message?.model) {
          const parsed = resolveUsableFacadeModel(message.model);
          if (parsed) model = parsed;
        }
        beginAssistantMessage(message?.id && typeof message.id === 'string' ? message.id : undefined);
        return [messageUpdated(assistantInfo({ usage: message?.usage }))];
      }

      case 'message_update':
        if (usageHasRecordedNumbers(piEvent.message?.usage)) {
          lastUsage = piEvent.message.usage;
        }
        const updatedModel = resolveUsableFacadeModel(piEvent.message);
        if (updatedModel) model = updatedModel;
        return translateAssistantDelta(piEvent.assistantMessageEvent, piEvent.message);

      case 'message_end': {
        if (!assistantMessageID) return [];
        const endedModel = resolveUsableFacadeModel(piEvent.message);
        if (endedModel) model = endedModel;
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

      case 'compaction_end': {
        const events = [
          event('session.compact', { sessionID, status: 'end' }),
        ];
        // Pin inject listens for session.compacted. Abort/failure must not
        // pretend pins survived — only a finished compact emits that event.
        if (piEvent.aborted === true) return events;
        if (typeof piEvent.errorMessage === 'string' && piEvent.errorMessage.trim()) {
          return events;
        }
        events.push(event('session.compacted', {
          sessionID,
          ...(directory ? { directory } : {}),
        }));
        return events;
      }

      default:
        return [];
    }
  };

  return {
    translate,
    setAssistantMessage,
    setUserMessage,
    setFallbackModel,
    getFallbackModel() {
      return resolvedFallback;
    },
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
