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
import { isPlanReadyDecisionPrompt } from './pi-plan-locale';
import { maybeOpenPlanRailOnReady } from './pi-plan-ready';
import { refreshSessionPlan, usePiSessionPlanStore } from './pi-session-plan-store';

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
    const notify = applyPiExtensionUiNotify(payload.properties) || applyPiExtensionUiNotify(payload);
    if (notify?.sessionID) void refreshSessionPlan(notify.sessionID);
    return true;
  }

  const properties = payload.properties && typeof payload.properties === 'object'
    ? payload.properties as { prompt?: unknown; sessionID?: unknown }
    : null;
  const prompt = applyPiExtensionUiPrompt(properties?.prompt);
  if (prompt) {
    maybeResolveStashedEditor(prompt);
    if (payload.type === 'pi.ui.asked') {
      const plan = usePiSessionPlanStore.getState().plansBySession[prompt.sessionID] ?? null;
      maybeOpenPlanRailOnReady({
        sessionID: prompt.sessionID,
        previous: plan,
        next: plan,
        prompt,
        directoryHint: prompt.directory,
      });
      // /plan start opens an empty rail. plan_mode_complete writes jsonl
      // before this select; GET fills markdown without waiting for remount.
      if (isPlanReadyDecisionPrompt(prompt)) {
        void refreshSessionPlan(prompt.sessionID);
      }
    }
    if (payload.type === 'pi.ui.settled') void refreshSessionPlan(prompt.sessionID);
  } else if (payload.type === 'pi.ui.settled' && typeof properties?.sessionID === 'string') {
    void refreshSessionPlan(properties.sessionID);
  }
  return true;
};
