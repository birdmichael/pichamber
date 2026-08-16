import { formatEffortLabel } from './mobileControlsUtils';

export const PI_THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const;
export type PiThinkingLevel = (typeof PI_THINKING_LEVELS)[number];

export type PiThinkingChipPresentation =
  | { status: 'pending' }
  | { status: 'ready'; level: PiThinkingLevel; label: string };

export function isPiThinkingLevel(value: string): value is PiThinkingLevel {
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
