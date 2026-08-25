import { create } from 'zustand';
import { toast as sonnerToast } from 'sonner';

import { toast } from '@/components/ui';
import { formatMessage, useI18nStore } from '@/lib/i18n';
import {
  isBlockingPiExtensionUiKind,
  parsePiExtensionUiNotify,
  parsePiExtensionUiPrompt,
  type PiExtensionUiPrompt,
} from './pi-extension-ui';
import { localizePiPlanNotifyMessage, planNotifyDedupeKey } from './pi-plan-locale';

const MAX_SETTLED_PER_SESSION = 20;
const MAX_NOTIFIES = 20;

/** Info Plan/plugin notifies must not sit on the composer or require OK. */
export const PI_EXTENSION_UI_NOTIFY_TOAST_POSITION = 'top-center' as const;
export const PI_EXTENSION_UI_INFO_TOAST_MS = 3000;
export const PI_EXTENSION_UI_WARNING_TOAST_MS = 5000;
export const PI_EXTENSION_UI_ERROR_TOAST_MS = 8000;

export type PiExtensionUiNotifyLevel = 'info' | 'warning' | 'error';

export type PiExtensionUiNotifyToastOptions = {
  duration: number;
  position: typeof PI_EXTENSION_UI_NOTIFY_TOAST_POSITION;
};

export const piExtensionUiNotifyToastOptions = (
  level: PiExtensionUiNotifyLevel,
): PiExtensionUiNotifyToastOptions => {
  if (level === 'error') {
    return {
      duration: PI_EXTENSION_UI_ERROR_TOAST_MS,
      position: PI_EXTENSION_UI_NOTIFY_TOAST_POSITION,
    };
  }
  if (level === 'warning') {
    return {
      duration: PI_EXTENSION_UI_WARNING_TOAST_MS,
      position: PI_EXTENSION_UI_NOTIFY_TOAST_POSITION,
    };
  }
  return {
    duration: PI_EXTENSION_UI_INFO_TOAST_MS,
    position: PI_EXTENSION_UI_NOTIFY_TOAST_POSITION,
  };
};

type EditorStash = {
  sessionID: string;
  text: string;
};

type PiExtensionUiNotifyItem = {
  id: string;
  sessionID: string;
  directory?: string;
  message: string;
  level: PiExtensionUiNotifyLevel;
};

type PiExtensionUiState = {
  promptsBySession: Record<string, PiExtensionUiPrompt[]>;
  notifies: PiExtensionUiNotifyItem[];
  editorStash: EditorStash | null;
};

let notifySeq = 0;
const nextNotifyId = (): string => `pin_${Date.now()}_${++notifySeq}`;
const recentNotifyAt = new Map<string, number>();
const NOTIFY_DEDUPE_MS = 2500;

export const presentPiExtensionUiNotify = (notify: {
  message: string;
  level: PiExtensionUiNotifyLevel;
}): void => {
  const message = notify.message.trim();
  if (!message) return;
  const now = Date.now();
  const dedupeKey = planNotifyDedupeKey(message);
  const last = recentNotifyAt.get(dedupeKey) ?? 0;
  if (now - last < NOTIFY_DEDUPE_MS) return;
  recentNotifyAt.set(dedupeKey, now);
  const visible = localizePiPlanNotifyMessage(message, (key) => (
    formatMessage(useI18nStore.getState().dictionary, key)
  ));
  const options = piExtensionUiNotifyToastOptions(notify.level);
  // Shared `toast.info` / `toast.success` inject an OK action that looks like a
  // confirm and sits on the composer. Info/warning notifies go through Sonner
  // directly so they auto-dismiss without a button. Errors keep Copy.
  if (notify.level === 'error') toast.error(visible, options);
  else if (notify.level === 'warning') sonnerToast.warning(visible, options);
  else sonnerToast.info(visible, options);
};

const empty: PiExtensionUiPrompt[] = [];

const upsertPrompt = (
  current: PiExtensionUiPrompt[],
  prompt: PiExtensionUiPrompt,
): PiExtensionUiPrompt[] => {
  const index = current.findIndex((item) => item.id === prompt.id);
  if (index === -1) {
    const next = [...current, prompt];
    const pending = next.filter((item) => item.status === 'pending');
    const settled = next.filter((item) => item.status !== 'pending');
    return [...settled.slice(-MAX_SETTLED_PER_SESSION), ...pending];
  }
  if (current[index] === prompt) return current;
  const next = [...current];
  next[index] = prompt;
  return next;
};

export const usePiExtensionUiStore = create<PiExtensionUiState>(() => ({
  promptsBySession: {},
  notifies: [],
  editorStash: null,
}));

export const resetPiExtensionUiStore = (): void => {
  recentNotifyAt.clear();
  usePiExtensionUiStore.setState({ promptsBySession: {}, notifies: [], editorStash: null });
};

export const applyPiExtensionUiPrompt = (value: unknown): PiExtensionUiPrompt | null => {
  const prompt = parsePiExtensionUiPrompt(value);
  if (!prompt) return null;
  usePiExtensionUiStore.setState((state) => {
    const current = state.promptsBySession[prompt.sessionID] ?? empty;
    const next = upsertPrompt(current, prompt);
    if (next === current) return state;
    return {
      ...state,
      promptsBySession: {
        ...state.promptsBySession,
        [prompt.sessionID]: next,
      },
    };
  });
  return prompt;
};

export const applyPiExtensionUiNotify = (value: unknown): PiExtensionUiNotifyItem | null => {
  const notify = parsePiExtensionUiNotify(value);
  if (!notify) return null;
  const item: PiExtensionUiNotifyItem = {
    id: nextNotifyId(),
    sessionID: notify.sessionID,
    directory: notify.directory,
    message: notify.message,
    level: notify.level,
  };
  usePiExtensionUiStore.setState((state) => ({
    ...state,
    notifies: [...state.notifies, item].slice(-MAX_NOTIFIES),
  }));
  presentPiExtensionUiNotify(item);
  return item;
};

export const consumePiExtensionUiNotify = (id: string): void => {
  consumePiExtensionUiNotifies([id]);
};

export const consumePiExtensionUiNotifies = (ids: readonly string[]): void => {
  if (ids.length === 0) return;
  const idSet = new Set(ids);
  usePiExtensionUiStore.setState((state) => {
    const next = state.notifies.filter((item) => !idSet.has(item.id));
    if (next.length === state.notifies.length) return state;
    return { ...state, notifies: next };
  });
};

export const reconcilePiExtensionUiPrompts = (
  sessionID: string,
  incoming: PiExtensionUiPrompt[] | null,
): void => {
  if (incoming === null) return;
  usePiExtensionUiStore.setState((state) => {
    const current = state.promptsBySession[sessionID] ?? empty;
    const incomingIds = new Set(incoming.map((prompt) => prompt.id));
    const settled = current.filter((prompt) => prompt.status !== 'pending' && !incomingIds.has(prompt.id));
    return {
      ...state,
      promptsBySession: {
        ...state.promptsBySession,
        [sessionID]: [...settled.slice(-MAX_SETTLED_PER_SESSION), ...incoming],
      },
    };
  });
};

export const stashPiExtensionUiEditorText = (sessionID: string, text: string): void => {
  usePiExtensionUiStore.setState({ editorStash: { sessionID, text } });
};

export const consumePiExtensionUiEditorStash = (sessionID: string): string | null => {
  const stash = usePiExtensionUiStore.getState().editorStash;
  if (!stash || stash.sessionID !== sessionID) return null;
  usePiExtensionUiStore.setState({ editorStash: null });
  return stash.text;
};

export const usePiExtensionUiPrompts = (sessionID: string | null | undefined): PiExtensionUiPrompt[] => (
  usePiExtensionUiStore((state) => (sessionID ? state.promptsBySession[sessionID] ?? empty : empty))
);

export const useHasPendingPiExtensionUiPrompt = (sessionID: string | null | undefined): boolean => (
  usePiExtensionUiStore((state) => {
    if (!sessionID) return false;
    return (state.promptsBySession[sessionID] ?? empty).some((prompt) => (
      prompt.status === 'pending' && isBlockingPiExtensionUiKind(prompt.kind)
    ));
  })
);

/** Bottom-dock cards: pending select/input/editor that are not bound to a question-tool turn. */
export const selectTranscriptPiExtensionUiPrompts = (
  prompts: PiExtensionUiPrompt[],
): PiExtensionUiPrompt[] => prompts.filter((prompt) => (
  prompt.kind !== 'confirm' && prompt.status === 'pending'
));

export const selectPendingConfirmPrompt = (
  prompts: PiExtensionUiPrompt[],
): PiExtensionUiPrompt | null => (
  prompts.find((prompt) => prompt.kind === 'confirm' && prompt.status === 'pending') ?? null
);
