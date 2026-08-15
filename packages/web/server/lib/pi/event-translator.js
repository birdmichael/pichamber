import { createEventId, createMessageId, createPartId } from './ids.js';

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
  let userMessageID = null;

  const event = (type, properties) => createOpenCodeEvent(type, properties, {
    id: nextEventId(),
    now: now(),
  });

  const setAssistantMessage = (messageID) => {
    assistantMessageID = messageID;
  };

  const setUserMessage = (messageID) => {
    userMessageID = messageID;
  };

  const assistantInfo = ({ completed = false, model } = {}) => {
    const created = now();
    return {
      id: assistantMessageID,
      sessionID,
      role: 'assistant',
      time: completed ? { created, completed } : { created },
      ...(model ? { model } : {}),
    };
  };

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

  const toolPart = (partID, { callID, tool, status, input, output, error }) => ({
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
      time: { start: now(), ...(status === 'completed' || status === 'error' ? { end: now() } : {}) },
    },
  });

  const translateAssistantDelta = (delta) => {
    if (!delta || typeof delta !== 'object') return [];
    const contentIndex = typeof delta.contentIndex === 'number' ? delta.contentIndex : 0;

    switch (delta.type) {
      case 'text_start': {
        if (!assistantMessageID) {
          assistantMessageID = nextMessageId();
        }
        const partID = nextPartId();
        textParts.set(contentIndex, partID);
        return [
          event('message.updated', { info: assistantInfo() }),
          event('message.part.updated', { sessionID, part: textPart(partID, '') }),
        ];
      }
      case 'text_delta': {
        if (!assistantMessageID) {
          assistantMessageID = nextMessageId();
        }
        let partID = textParts.get(contentIndex);
        const created = [];
        if (!partID) {
          partID = nextPartId();
          textParts.set(contentIndex, partID);
          created.push(event('message.updated', { info: assistantInfo() }));
          created.push(event('message.part.updated', { sessionID, part: textPart(partID, '') }));
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
        return [event('message.part.updated', { sessionID, part: textPart(partID, text) })];
      }
      case 'thinking_start': {
        if (!assistantMessageID) {
          assistantMessageID = nextMessageId();
        }
        const partID = nextPartId();
        reasoningParts.set(contentIndex, partID);
        return [
          event('message.updated', { info: assistantInfo() }),
          event('message.part.updated', { sessionID, part: reasoningPart(partID, '') }),
        ];
      }
      case 'thinking_delta': {
        if (!assistantMessageID) {
          assistantMessageID = nextMessageId();
        }
        let partID = reasoningParts.get(contentIndex);
        const created = [];
        if (!partID) {
          partID = nextPartId();
          reasoningParts.set(contentIndex, partID);
          created.push(event('message.updated', { info: assistantInfo() }));
          created.push(event('message.part.updated', { sessionID, part: reasoningPart(partID, '') }));
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
        return [event('message.part.updated', { sessionID, part: reasoningPart(partID, text) })];
      }
      case 'toolcall_start': {
        if (!assistantMessageID) {
          assistantMessageID = nextMessageId();
        }
        const callID = delta.toolCall?.id || delta.id || nextPartId();
        const tool = delta.toolCall?.name || delta.name || 'tool';
        const partID = nextPartId();
        toolParts.set(callID, partID);
        return [
          event('message.updated', { info: assistantInfo() }),
          event('message.part.updated', {
            sessionID,
            part: toolPart(partID, { callID, tool, status: 'pending', input: delta.toolCall?.arguments || {} }),
          }),
        ];
      }
      case 'toolcall_end': {
        const call = delta.toolCall || {};
        const callID = call.id || delta.id;
        const partID = callID ? toolParts.get(callID) : null;
        if (!partID || !assistantMessageID) return [];
        return [event('message.part.updated', {
          sessionID,
          part: toolPart(partID, {
            callID,
            tool: call.name || 'tool',
            status: 'pending',
            input: call.arguments || {},
          }),
        })];
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
          userMessageID = message.id || userMessageID || nextMessageId();
          const text = typeof message.content === 'string'
            ? message.content
            : Array.isArray(message.content)
              ? message.content.filter((block) => block?.type === 'text').map((block) => block.text).join('')
              : '';
          const partID = nextPartId();
          return [
            event('message.updated', {
              info: {
                id: userMessageID,
                sessionID,
                role: 'user',
                time: { created: now() },
              },
            }),
            event('message.part.updated', {
              sessionID,
              part: {
                id: partID,
                sessionID,
                messageID: userMessageID,
                type: 'text',
                text,
              },
            }),
          ];
        }
        assistantMessageID = nextMessageId();
        textParts.clear();
        reasoningParts.clear();
        toolParts.clear();
        return [event('message.updated', { info: assistantInfo() })];
      }

      case 'message_update':
        return translateAssistantDelta(piEvent.assistantMessageEvent);

      case 'message_end': {
        if (!assistantMessageID) return [];
        const events = [event('message.updated', { info: assistantInfo({ completed: true }) })];
        return events;
      }

      case 'tool_execution_start': {
        if (!assistantMessageID) {
          assistantMessageID = nextMessageId();
        }
        const callID = piEvent.toolCallId;
        let partID = toolParts.get(callID);
        const created = [];
        if (!partID) {
          partID = nextPartId();
          toolParts.set(callID, partID);
          created.push(event('message.updated', { info: assistantInfo() }));
        }
        created.push(event('message.part.updated', {
          sessionID,
          part: toolPart(partID, {
            callID,
            tool: piEvent.toolName || 'tool',
            status: 'running',
            input: piEvent.args || {},
          }),
        }));
        return created;
      }

      case 'tool_execution_update': {
        const callID = piEvent.toolCallId;
        const partID = toolParts.get(callID);
        if (!partID || !assistantMessageID) return [];
        const output = toolText(piEvent.partialResult?.content ?? piEvent.partialResult);
        return [event('message.part.updated', {
          sessionID,
          part: toolPart(partID, {
            callID,
            tool: piEvent.toolName || 'tool',
            status: 'running',
            input: piEvent.args || {},
            output,
          }),
        })];
      }

      case 'tool_execution_end': {
        const callID = piEvent.toolCallId;
        const partID = toolParts.get(callID);
        if (!partID || !assistantMessageID) return [];
        const output = toolText(piEvent.result?.content ?? piEvent.result);
        return [event('message.part.updated', {
          sessionID,
          part: toolPart(partID, {
            callID,
            tool: piEvent.toolName || 'tool',
            status: piEvent.isError ? 'error' : 'completed',
            input: piEvent.args || {},
            output,
            error: piEvent.isError ? output || 'tool error' : undefined,
          }),
        })];
      }

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
    if (!part || part.type !== 'file' || typeof part.url !== 'string') continue;
    if (!part.mime || !String(part.mime).startsWith('image/')) continue;
    const url = part.url;
    if (!url.startsWith('data:')) continue;
    const comma = url.indexOf(',');
    if (comma === -1) continue;
    images.push({
      type: 'image',
      source: {
        type: 'base64',
        mediaType: part.mime,
        data: url.slice(comma + 1),
      },
    });
  }
  return images;
};
