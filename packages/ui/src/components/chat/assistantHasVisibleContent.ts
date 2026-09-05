import type { ChatMessageEntry } from './lib/turns/types';

/** True when sorted-mode should keep this assistant row (parts or info.error). */
export const assistantHasVisibleContent = (message: ChatMessageEntry): boolean => {
  const info = message.info as { error?: { data?: { message?: unknown }; message?: unknown; name?: unknown } } | undefined;
  const errorInfo = info?.error;
  if (errorInfo) {
    const dataMessage = typeof errorInfo.data?.message === 'string' ? errorInfo.data.message.trim() : '';
    const errorMessage = typeof errorInfo.message === 'string' ? errorInfo.message.trim() : '';
    const errorName = typeof errorInfo.name === 'string' ? errorInfo.name.trim() : '';
    if (dataMessage || errorMessage || errorName) {
      return true;
    }
  }

  const parts = message.parts || [];
  return parts.some((part) => {
    const type = part?.type;
    const leftover = type as string | undefined;
    if (type === 'text' || type === 'reasoning') {
      const text = typeof (part as { text?: unknown }).text === 'string' ? (part as { text: string }).text : '';
      return text.trim().length > 0;
    }
    // Pi parts use `tool`. Leftover OpenCode names are not in the union.
    if (type === 'tool' || leftover === 'toolCall' || leftover === 'toolResult' || leftover === 'tool-invocation') {
      return true;
    }
    return Boolean(
      leftover
      && leftover !== 'step-start'
      && leftover !== 'step-finish'
      && leftover !== 'step_start'
      && leftover !== 'step_finish',
    );
  });
};
