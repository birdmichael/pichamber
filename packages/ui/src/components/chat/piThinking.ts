import { formatEffortLabel } from './mobileControlsUtils';

export const PI_THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const;
export type PiThinkingLevel = (typeof PI_THINKING_LEVELS)[number];

export type PiThinkingChipPresentation =
  | { status: 'pending' }
  | { status: 'ready'; level: PiThinkingLevel; label: string };

function isPiThinkingLevel(value: string): value is PiThinkingLevel {
  return (PI_THINKING_LEVELS as readonly string[]).includes(value);
}

/** Parse a saved/default thinking level. Missing or unknown values stay unset — never imply `high`. */
export function parsePiThinkingLevel(value: unknown): PiThinkingLevel | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const next = value.trim();
  return isPiThinkingLevel(next) ? next : undefined;
}

export function resolvePiThinkingChipPresentation(level: string | undefined): PiThinkingChipPresentation {
  const parsed = parsePiThinkingLevel(level);
  if (!parsed) {
    return { status: 'pending' };
  }
  return { status: 'ready', level: parsed, label: formatEffortLabel(parsed) };
}

/**
 * Live Pi `getAvailableThinkingLevels()` filtered to known Pi levels,
 * keeping catalog order. Empty or unknown payloads stay omitted so the
 * chip can keep the full list until the session answers.
 */
export function parseAvailablePiThinkingLevels(value: unknown): PiThinkingLevel[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const next: PiThinkingLevel[] = [];
  const seen = new Set<PiThinkingLevel>();
  for (const item of value) {
    const parsed = parsePiThinkingLevel(item);
    if (!parsed || seen.has(parsed)) {
      continue;
    }
    seen.add(parsed);
    next.push(parsed);
  }
  return next;
}

export function resolveVisiblePiThinkingLevels(
  available: readonly string[] | undefined,
): readonly PiThinkingLevel[] {
  const parsed = parseAvailablePiThinkingLevels(available);
  return parsed.length > 0 ? parsed : PI_THINKING_LEVELS;
}

export function clampPiThinkingLevel(
  level: string | undefined,
  available: readonly string[] | undefined,
): PiThinkingLevel | undefined {
  const parsed = parsePiThinkingLevel(level);
  const visible = resolveVisiblePiThinkingLevels(available);
  if (parsed && visible.includes(parsed)) {
    return parsed;
  }
  if (visible.includes('medium')) {
    return 'medium';
  }
  return visible[0];
}
