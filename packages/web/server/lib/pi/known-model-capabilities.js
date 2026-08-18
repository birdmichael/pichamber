const VENDOR_MODEL_ID_PREFIXES = [
  'x-ai/',
  'xai/',
  'openai/',
  'anthropic/',
  'google/',
  'deepseek/',
];

const KNOWN_VISION_MODEL_IDS = new Set([
  'gpt-4o',
  'gpt-4o-mini',
  'gpt-4o-2024-05-13',
  'gpt-4o-2024-08-06',
  'gpt-4o-2024-11-20',
  'gpt-4.1',
  'gpt-4.1-mini',
  'gpt-4.1-nano',
  'gpt-4.1-2025-04-14',
  'gpt-4.1-mini-2025-04-14',
  'gpt-4.1-nano-2025-04-14',
  'claude-fable-5',
  'claude-mythos-5',
  'claude-mythos-preview',
  'claude-opus-5',
  'claude-sonnet-5',
  'claude-opus-4-8',
  'claude-opus-4-7',
  'claude-opus-4-6',
  'claude-sonnet-4-6',
  'opus-4-8',
  'opus-4-7',
  'opus-4-6',
  'opus-4.6',
  'opus-5',
  'sonnet-4-6',
  'sonnet-4.6',
  'sonnet-5',
  'fable-5',
  'claude-haiku-4-5',
  'claude-haiku-4-5-20251001',
  'claude-sonnet-4-5',
  'claude-sonnet-4-5-20250929',
  'claude-opus-4-5',
  'claude-opus-4-5-20251101',
  'claude-sonnet-4',
  'claude-opus-4',
  'claude-opus-4-1',
  'claude-3-5-sonnet',
  'claude-3-5-haiku',
  'claude-3-7-sonnet',
  'haiku-4-5',
  'haiku-4.5',
  'sonnet-4-5',
  'sonnet-4.5',
  'opus-4-5',
  'opus-4.5',
  'grok-4.6',
  'grok-4.5',
  'grok-4.5-latest',
  'grok-4.3',
  'grok-4.3-latest',
  'grok-4.20-0309-reasoning',
  'grok-4.20-0309-non-reasoning',
  'grok-4.20-multi-agent-0309',
  'grok-build-0.1',
  'grok-build-latest',
  'gemini-2.5-pro',
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
  'gemini-2.5-flash-lite-preview-06-17',
]);

const KNOWN_REASONING_MODEL_IDS = new Set([
  'claude-fable-5',
  'claude-mythos-5',
  'claude-mythos-preview',
  'claude-opus-5',
  'claude-sonnet-5',
  'claude-opus-4-8',
  'claude-opus-4-7',
  'claude-opus-4-6',
  'claude-sonnet-4-6',
  'opus-4-8',
  'opus-4-7',
  'opus-4-6',
  'opus-4.6',
  'opus-5',
  'sonnet-4-6',
  'sonnet-4.6',
  'sonnet-5',
  'fable-5',
  'claude-haiku-4-5',
  'claude-haiku-4-5-20251001',
  'claude-sonnet-4-5',
  'claude-sonnet-4-5-20250929',
  'claude-opus-4-5',
  'claude-opus-4-5-20251101',
  'claude-sonnet-4',
  'claude-opus-4',
  'claude-opus-4-1',
  'claude-3-7-sonnet',
  'haiku-4-5',
  'haiku-4.5',
  'sonnet-4-5',
  'sonnet-4.5',
  'opus-4-5',
  'opus-4.5',
  'grok-4.6',
  'grok-4.5',
  'grok-4.5-latest',
  'grok-4.3',
  'grok-4.3-latest',
  'grok-4.20-0309-reasoning',
  'grok-4.20-multi-agent-0309',
  'grok-build-0.1',
  'grok-build-latest',
  'gemini-2.5-pro',
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
  'gemini-2.5-flash-lite-preview-06-17',
  'deepseek-v4-flash',
  'deepseek-v4-pro',
  'deepseek-reasoner',
]);

export const normalizeKnownModelId = (id) => {
  let next = typeof id === 'string' ? id.trim().toLowerCase() : '';
  if (!next) return '';
  for (const prefix of VENDOR_MODEL_ID_PREFIXES) {
    if (next.startsWith(prefix)) {
      next = next.slice(prefix.length);
      break;
    }
  }
  return next;
};

export const lookupKnownVisionInput = (id) => {
  const normalized = normalizeKnownModelId(id);
  return normalized && KNOWN_VISION_MODEL_IDS.has(normalized) ? ['text', 'image'] : undefined;
};

export const lookupKnownReasoning = (id) => {
  const normalized = normalizeKnownModelId(id);
  if (!normalized) return undefined;
  if (KNOWN_REASONING_MODEL_IDS.has(normalized)) return true;
  return undefined;
};

const isDefaultTextInput = (input) => (
  Array.isArray(input) && input.length === 1 && input[0] === 'text'
);

export const enrichKnownModelEntry = (id, model = {}) => {
  const next = model && typeof model === 'object' && !Array.isArray(model) ? { ...model } : {};
  const vision = lookupKnownVisionInput(id);
  const reasoning = lookupKnownReasoning(id);
  let changed = false;
  if (vision && (!Array.isArray(next.input) || isDefaultTextInput(next.input))) {
    next.input = vision;
    changed = true;
  }
  if (reasoning === true && next.reasoning !== true) {
    next.reasoning = true;
    changed = true;
  }
  return { model: next, changed };
};
