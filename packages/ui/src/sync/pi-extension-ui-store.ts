import { create } from 'zustand';

import {
  isBlockingPiExtensionUiKind,
  parsePiExtensionUiPrompt,
  type PiExtensionUiPrompt,
} from './pi-extension-ui';

const MAX_SETTLED_PER_SESSION = 20;

type EditorStash = {
  sessionID: string;
  text: string;
};

type PiExtensionUiState = {
  promptsBySession: Record<string, PiExtensionUiPrompt[]>;
  editorStash: EditorStash | null;
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
  editorStash: null,
}));

export const resetPiExtensionUiStore = (): void => {
  usePiExtensionUiStore.setState({ promptsBySession: {}, editorStash: null });
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

export const getPiExtensionUiPrompts = (sessionID: string | null | undefined): PiExtensionUiPrompt[] => {
  if (!sessionID) return empty;
  return usePiExtensionUiStore.getState().promptsBySession[sessionID] ?? empty;
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

export const selectTranscriptPiExtensionUiPrompts = (
  prompts: PiExtensionUiPrompt[],
): PiExtensionUiPrompt[] => prompts.filter((prompt) => prompt.kind !== 'confirm');

export const selectPendingConfirmPrompt = (
  prompts: PiExtensionUiPrompt[],
): PiExtensionUiPrompt | null => (
  prompts.find((prompt) => prompt.kind === 'confirm' && prompt.status === 'pending') ?? null
);
