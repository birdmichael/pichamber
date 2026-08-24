import { runtimeFetch } from '@/lib/runtime-fetch';

export type PiExtensionUiKind = 'select' | 'confirm' | 'input' | 'editor';
export type PiExtensionUiStatus = 'pending' | 'replied' | 'cancelled';

export type PiExtensionUiPrompt = {
  id: string;
  sessionID: string;
  directory?: string;
  kind: PiExtensionUiKind;
  title: string;
  message?: string;
  options?: string[];
  placeholder?: string;
  prefill?: string;
  multiple: boolean;
  status: PiExtensionUiStatus;
  value?: unknown;
};

type PiExtensionUiNotify = {
  sessionID: string;
  directory?: string;
  message: string;
  level: 'info' | 'warning' | 'error';
};

const isKind = (value: unknown): value is PiExtensionUiKind => (
  value === 'select' || value === 'confirm' || value === 'input' || value === 'editor'
);

const isStatus = (value: unknown): value is PiExtensionUiStatus => (
  value === 'pending' || value === 'replied' || value === 'cancelled'
);

const asOptionalString = (value: unknown): string | undefined => (
  typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined
);

const messageFromUnknown = (value: unknown): string | undefined => {
  const direct = asOptionalString(value);
  if (direct) return direct;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  return asOptionalString(record.message)
    ?? asOptionalString(record.title)
    ?? asOptionalString(record.text)
    ?? asOptionalString(record.body);
};

export const parsePiExtensionUiPrompt = (value: unknown): PiExtensionUiPrompt | null => {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const id = asOptionalString(raw.id);
  const sessionID = asOptionalString(raw.sessionID);
  if (!id || !sessionID || !isKind(raw.kind)) return null;
  return {
    id,
    sessionID,
    directory: asOptionalString(raw.directory),
    kind: raw.kind,
    title: typeof raw.title === 'string' ? raw.title : '',
    message: typeof raw.message === 'string' ? raw.message : undefined,
    options: Array.isArray(raw.options) ? raw.options.map((option) => String(option)) : undefined,
    placeholder: typeof raw.placeholder === 'string' ? raw.placeholder : undefined,
    prefill: typeof raw.prefill === 'string' ? raw.prefill : undefined,
    multiple: raw.multiple === true,
    status: isStatus(raw.status) ? raw.status : 'pending',
    value: raw.value,
  };
};

export const parsePiExtensionUiPromptList = (value: unknown): PiExtensionUiPrompt[] | null => {
  if (!Array.isArray(value)) return null;
  const prompts: PiExtensionUiPrompt[] = [];
  for (const item of value) {
    const prompt = parsePiExtensionUiPrompt(item);
    if (prompt) prompts.push(prompt);
  }
  return prompts;
};

export const parsePiExtensionUiNotify = (value: unknown): PiExtensionUiNotify | null => {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const nested = raw.properties && typeof raw.properties === 'object'
    ? raw.properties as Record<string, unknown>
    : null;
  const source = nested ?? raw;
  const message = messageFromUnknown(source.message)
    ?? asOptionalString(source.title)
    ?? asOptionalString(source.text)
    ?? asOptionalString(source.body)
    ?? messageFromUnknown(raw.message)
    ?? asOptionalString(raw.title);
  if (!message) return null;
  return {
    sessionID: asOptionalString(source.sessionID)
      ?? asOptionalString(source.sessionId)
      ?? asOptionalString(raw.sessionID)
      ?? asOptionalString(raw.sessionId)
      ?? '',
    directory: asOptionalString(source.directory) ?? asOptionalString(raw.directory),
    message,
    level: source.level === 'warning' || source.level === 'error'
      ? source.level
      : raw.level === 'warning' || raw.level === 'error' ? raw.level : 'info',
  };
};

const FREEFORM_OTHER_OPTION = /^(?:\d+\.\s*)?other\b/i;
const TYPE_SOMETHING_OPTION = /^(?:\d+\.\s*)?type something\.?\s*$/i;

export const isTypeSomethingOption = (option: string): boolean => (
  TYPE_SOMETHING_OPTION.test(option.trim())
);

export const isFreeformOtherOption = (option: string): boolean => {
  const trimmed = option.trim();
  return FREEFORM_OTHER_OPTION.test(trimmed) || TYPE_SOMETHING_OPTION.test(trimmed);
};

export const displaySelectOption = (option: string): { label: string; description?: string; raw: string } => {
  const numbered = option.replace(/^\d+\.\s*/, '');
  const parts = numbered.split(/\s+[—–]\s+/);
  if (parts.length >= 2) {
    return { label: parts[0] ?? numbered, description: parts.slice(1).join(' — '), raw: option };
  }
  return { label: numbered || option, raw: option };
};

export const isBlockingPiExtensionUiKind = (kind: PiExtensionUiKind): boolean => (
  kind === 'select' || kind === 'input' || kind === 'editor' || kind === 'confirm'
);

export const listPiExtensionUiPrompts = async (sessionID: string): Promise<PiExtensionUiPrompt[] | null> => {
  try {
    const response = await runtimeFetch('/api/pi/ui', {
      method: 'GET',
      query: { session: sessionID },
    });
    if (!response.ok) return null;
    return parsePiExtensionUiPromptList(await response.json());
  } catch {
    return null;
  }
};

const postPiExtensionUi = async (
  path: string,
  sessionID: string,
  body: Record<string, unknown> = {},
): Promise<boolean> => {
  const response = await runtimeFetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    query: { session: sessionID },
    body: JSON.stringify({ sessionID, ...body }),
  });
  if (response.status === 404) {
    const error = new Error('Extension UI prompt is no longer pending');
    error.name = 'PiExtensionUiNotFoundError';
    throw error;
  }
  if (!response.ok) {
    throw new Error(`Extension UI request failed (${response.status})`);
  }
  return true;
};

export const replyPiExtensionUi = async (
  sessionID: string,
  promptID: string,
  value: unknown,
): Promise<boolean> => postPiExtensionUi(`/api/pi/ui/${encodeURIComponent(promptID)}/reply`, sessionID, { value });

export const cancelPiExtensionUi = async (
  sessionID: string,
  promptID: string,
): Promise<boolean> => postPiExtensionUi(`/api/pi/ui/${encodeURIComponent(promptID)}/cancel`, sessionID);

export const isPiExtensionUiNotFoundError = (error: unknown): boolean => (
  error instanceof Error && error.name === 'PiExtensionUiNotFoundError'
);
