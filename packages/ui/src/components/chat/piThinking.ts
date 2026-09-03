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

/** Empty or `off`-only live lists are not this model's effort set. */
export function isNarrowPiThinkingAvailable(available: unknown): boolean {
  const parsed = parseAvailablePiThinkingLevels(available);
  return parsed.length === 0 || (parsed.length === 1 && parsed[0] === 'off');
}

/**
 * Keep a known Pi current (incl catalog `xhigh`) in the menu when live
 * omitted it. Do not re-add a leftover pin the catalog itself dropped.
 */
export function unionCurrentIntoPiThinkingLevels(
  levels: readonly PiThinkingLevel[],
  current: string | undefined,
  catalog: readonly PiThinkingLevel[],
): PiThinkingLevel[] {
  const parsed = parsePiThinkingLevel(current);
  if (!parsed || levels.includes(parsed)) {
    return [...levels];
  }
  if (catalog.length > 0 && !catalog.includes(parsed)) {
    return [...levels];
  }
  return [...levels, parsed];
}

/**
 * Empty catalog does not invent seven levels. A non-narrow live list from
 * the session still owns the menu when catalog is silent, so the chip
 * cannot vanish after send (#513). A leftover pin that live omitted
 * becomes the live max, not a blank. A known current still unions into
 * that live list when the catalog includes it. Unset current stays
 * pending — do not invent `medium` before GET.
 */
export function resolvePairedPiThinking(input: {
  current?: string | null;
  catalogLevels: readonly string[];
  liveAvailable?: unknown;
}): { thinking: PiThinkingLevel | undefined; levels: PiThinkingLevel[] } {
  const catalog = parseAvailablePiThinkingLevels(input.catalogLevels);
  const live = parseAvailablePiThinkingLevels(input.liveAvailable);
  if (catalog.length === 0) {
    if (isNarrowPiThinkingAvailable(live)) {
      return { thinking: undefined, levels: [] };
    }
    const parsed = parsePiThinkingLevel(input.current ?? undefined);
    if (!parsed) {
      return { thinking: undefined, levels: [...live] };
    }
    return {
      thinking: live.includes(parsed) ? parsed : live[live.length - 1],
      levels: [...live],
    };
  }
  const base = !isNarrowPiThinkingAvailable(live) ? live : catalog;
  const levels = unionCurrentIntoPiThinkingLevels(base, input.current ?? undefined, catalog);
  const parsed = parsePiThinkingLevel(input.current ?? undefined);
  if (!parsed) {
    return { thinking: undefined, levels };
  }
  return {
    thinking: clampPiThinkingLevel(parsed, levels),
    levels,
  };
}

export function resolveTranscriptThinkingLabel(input: {
  thinking?: unknown;
  variant?: unknown;
  modelVariant?: unknown;
}): PiThinkingLevel | undefined {
  return parsePiThinkingLevel(input.thinking)
    ?? parsePiThinkingLevel(input.variant)
    ?? parsePiThinkingLevel(input.modelVariant);
}

/**
 * Empty-draft menus prefer Pi kernel/SDK `thinkingLevels` on the selected
 * provider model. models.dev is only the fallback when Pi omitted a list.
 * Do not union catalog-only extras (xhigh) onto a real Pi list.
 */
export function preferPiModelThinkingLevels(
  piLevels: unknown,
  catalogLevels: readonly string[] = [],
): PiThinkingLevel[] {
  const fromPi = parseAvailablePiThinkingLevels(piLevels);
  if (fromPi.length > 0) return fromPi;
  return parseAvailablePiThinkingLevels(catalogLevels);
}

/**
 * Empty drafts have no GET /session/:id/thinking. Prefer the project pin,
 * then Pi defaults, then the current chip. Passing nothing stays unset —
 * never invent medium and ignore Settings / project pin.
 */
export function resolveEmptyDraftThinkingCurrent(input: {
  projectVariant?: string | null;
  defaultsThinking?: string | null;
  current?: string | null;
}): PiThinkingLevel | undefined {
  return parsePiThinkingLevel(input.projectVariant)
    ?? parsePiThinkingLevel(input.defaultsThinking)
    ?? parsePiThinkingLevel(input.current);
}

/** Composer send uses the Pi chip. Leftover OpenCode variant is off the Pi path. */
export function resolveComposerSendThinking(input: {
  isPiKernel?: boolean;
  chipLevel?: string | null;
  variant?: string | null;
}): PiThinkingLevel | undefined {
  const chip = parsePiThinkingLevel(input.chipLevel);
  if (chip) return chip;
  if (input.isPiKernel) return undefined;
  return parsePiThinkingLevel(input.variant);
}

export function nextCycledPiThinkingLevel(
  current: string | undefined,
  levels: readonly string[],
): PiThinkingLevel | undefined {
  const parsed = parseAvailablePiThinkingLevels(levels);
  if (parsed.length === 0) return undefined;
  const index = parsed.indexOf(parsePiThinkingLevel(current) as PiThinkingLevel);
  const nextIndex = index < 0 ? 0 : (index + 1) % parsed.length;
  return parsed[nextIndex];
}
