import {
  replyPiExtensionUi,
  type PiExtensionUiPrompt,
} from './pi-extension-ui';
import {
  applyPiExtensionUiNotify,
  applyPiExtensionUiPrompt,
  consumePiExtensionUiEditorStash,
  usePiExtensionUiStore,
} from './pi-extension-ui-store';

export const isPiExtensionUiEventType = (type: unknown): boolean => (
  type === 'pi.ui.asked' || type === 'pi.ui.settled' || type === 'pi.ui.notify'
);

const maybeResolveStashedEditor = (prompt: PiExtensionUiPrompt): void => {
  if (prompt.kind !== 'editor' || prompt.status !== 'pending') return;
  const text = consumePiExtensionUiEditorStash(prompt.sessionID);
  if (!text) return;
  void replyPiExtensionUi(prompt.sessionID, prompt.id, text).catch(() => {
    usePiExtensionUiStore.setState((state) => ({
      ...state,
      editorStash: { sessionID: prompt.sessionID, text },
    }));
  });
};

export const handlePiExtensionUiEvent = (payload: { type?: unknown; properties?: unknown }): boolean => {
  if (!isPiExtensionUiEventType(payload.type)) return false;

  if (payload.type === 'pi.ui.notify') {
    applyPiExtensionUiNotify(payload.properties) || applyPiExtensionUiNotify(payload);
    return true;
  }

  const properties = payload.properties && typeof payload.properties === 'object'
    ? payload.properties as { prompt?: unknown }
    : null;
  const prompt = applyPiExtensionUiPrompt(properties?.prompt);
  if (prompt) maybeResolveStashedEditor(prompt);
  return true;
};
