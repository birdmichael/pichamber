import { describe, expect, test } from 'bun:test';
import { resolveCatalogThinkingLevels } from '@/lib/model-catalog-capabilities';
import {
  clampPiThinkingLevel,
  isNarrowPiThinkingAvailable,
  parseAvailablePiThinkingLevels,
  parsePiThinkingLevel,
  preferPiModelThinkingLevels,
  nextCycledPiThinkingLevel,
  resolveComposerSendThinking,
  resolveEmptyDraftThinkingCurrent,
  resolvePairedPiThinking,
  resolvePiThinkingChipPresentation,
  resolveTranscriptThinkingLabel,
  resolveVisiblePiThinkingLevels,
  unionCurrentIntoPiThinkingLevels,
} from './piThinking';

describe('parsePiThinkingLevel', () => {
  test('accepts every saved Pi thinking level', () => {
    expect(parsePiThinkingLevel('off')).toBe('off');
    expect(parsePiThinkingLevel('minimal')).toBe('minimal');
    expect(parsePiThinkingLevel('low')).toBe('low');
    expect(parsePiThinkingLevel('medium')).toBe('medium');
    expect(parsePiThinkingLevel('high')).toBe('high');
    expect(parsePiThinkingLevel('xhigh')).toBe('xhigh');
    expect(parsePiThinkingLevel('max')).toBe('max');
  });

  test('trims whitespace from a valid level', () => {
    expect(parsePiThinkingLevel('  max  ')).toBe('max');
  });

  test('does not invent high when the payload is missing or invalid', () => {
    expect(parsePiThinkingLevel(undefined)).toBe(undefined);
    expect(parsePiThinkingLevel(null)).toBe(undefined);
    expect(parsePiThinkingLevel('')).toBe(undefined);
    expect(parsePiThinkingLevel('   ')).toBe(undefined);
    expect(parsePiThinkingLevel('HIGH')).toBe(undefined);
    expect(parsePiThinkingLevel('unknown')).toBe(undefined);
    expect(parsePiThinkingLevel(4)).toBe(undefined);
  });
});

describe('resolvePiThinkingChipPresentation', () => {
  test('first paint stays pending instead of flashing High', () => {
    expect(resolvePiThinkingChipPresentation(undefined)).toEqual({ status: 'pending' });
    expect(resolvePiThinkingChipPresentation('')).toEqual({ status: 'pending' });
  });

  test('renders the saved default once it is known', () => {
    expect(resolvePiThinkingChipPresentation('max')).toEqual({
      status: 'ready',
      level: 'max',
      label: 'Max',
    });
    expect(resolvePiThinkingChipPresentation('xhigh')).toEqual({
      status: 'ready',
      level: 'xhigh',
      label: 'xhigh',
    });
    expect(resolvePiThinkingChipPresentation('low')).toEqual({
      status: 'ready',
      level: 'low',
      label: 'Low',
    });
    expect(resolvePiThinkingChipPresentation('off')).toEqual({
      status: 'ready',
      level: 'off',
      label: 'Off',
    });
  });

  test('does not treat high as the implicit product default', () => {
    const pending = resolvePiThinkingChipPresentation(undefined);
    expect(pending).toEqual({ status: 'pending' });
    expect(pending).not.toEqual({ status: 'ready', level: 'high', label: 'High' });
  });
});

describe('available Pi thinking levels', () => {
  test('keeps live session order and drops unknown tokens', () => {
    expect(parseAvailablePiThinkingLevels(['low', 'medium', 'high', 'max', 'max', 'nope'])).toEqual([
      'low', 'medium', 'high', 'max',
    ]);
    expect(parseAvailablePiThinkingLevels(undefined)).toEqual([]);
    expect(parseAvailablePiThinkingLevels(['HIGH'])).toEqual([]);
  });

  test('falls back to the full Pi list until the session answers', () => {
    expect(resolveVisiblePiThinkingLevels(undefined)).toEqual([
      'off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max',
    ]);
    expect(resolveVisiblePiThinkingLevels(['low', 'high'])).toEqual(['low', 'high']);
  });

  test('clamps a saved default onto the live available list', () => {
    expect(clampPiThinkingLevel('max', ['low', 'medium', 'high'])).toBe('medium');
    expect(clampPiThinkingLevel('high', ['low', 'high'])).toBe('high');
    expect(clampPiThinkingLevel('off', ['low', 'high'])).toBe('low');
    expect(clampPiThinkingLevel(undefined, undefined)).toBe('medium');
  });
});

describe('resolvePairedPiThinking', () => {
  test('clamps a leftover pin onto the new model catalog immediately', () => {
    expect(resolvePairedPiThinking({
      current: 'xhigh',
      catalogLevels: ['low', 'medium', 'high'],
    })).toEqual({ thinking: 'medium', levels: ['low', 'medium', 'high'] });
    expect(resolvePairedPiThinking({
      current: 'high',
      catalogLevels: ['low', 'medium', 'high'],
    })).toEqual({ thinking: 'high', levels: ['low', 'medium', 'high'] });
  });

  test('clears the pin when the selected model has no levels', () => {
    expect(resolvePairedPiThinking({
      current: 'xhigh',
      catalogLevels: [],
    })).toEqual({ thinking: undefined, levels: [] });
    expect(resolvePairedPiThinking({
      current: 'xhigh',
      catalogLevels: [],
      liveAvailable: ['off', 'xhigh'],
    })).toEqual({ thinking: undefined, levels: [] });
  });

  test('non-narrow live is the menu, even when it is not a catalog subset', () => {
    expect(resolvePairedPiThinking({
      current: 'high',
      catalogLevels: ['low', 'medium', 'high', 'xhigh'],
      liveAvailable: ['off', 'minimal', 'low', 'medium', 'high'],
    })).toEqual({ thinking: 'high', levels: ['off', 'minimal', 'low', 'medium', 'high'] });
  });

  test('unions a known catalog current into live that omitted it', () => {
    expect(resolvePairedPiThinking({
      current: 'xhigh',
      catalogLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
      liveAvailable: ['low', 'medium', 'high'],
    })).toEqual({ thinking: 'xhigh', levels: ['low', 'medium', 'high', 'xhigh'] });
    expect(resolvePairedPiThinking({
      current: 'xhigh',
      catalogLevels: ['low', 'medium', 'high', 'xhigh'],
      liveAvailable: ['off', 'minimal', 'low', 'medium', 'high'],
    })).toEqual({
      thinking: 'xhigh',
      levels: ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'],
    });
  });

  test('unset current stays pending instead of painting medium', () => {
    expect(resolvePairedPiThinking({
      current: undefined,
      catalogLevels: ['low', 'medium', 'high', 'xhigh'],
    })).toEqual({ thinking: undefined, levels: ['low', 'medium', 'high', 'xhigh'] });
    expect(resolvePairedPiThinking({
      current: undefined,
      catalogLevels: ['low', 'medium', 'high', 'xhigh'],
      liveAvailable: ['off', 'minimal', 'low', 'medium', 'high'],
    })).toEqual({
      thinking: undefined,
      levels: ['off', 'minimal', 'low', 'medium', 'high'],
    });
  });

  test('off-only live is narrow and keeps the catalog', () => {
    expect(isNarrowPiThinkingAvailable(['off'])).toBe(true);
    expect(isNarrowPiThinkingAvailable([])).toBe(true);
    expect(isNarrowPiThinkingAvailable(['low', 'medium'])).toBe(false);
    expect(resolvePairedPiThinking({
      current: 'high',
      catalogLevels: ['off', 'low', 'medium', 'high'],
      liveAvailable: ['off'],
    })).toEqual({ thinking: 'high', levels: ['off', 'low', 'medium', 'high'] });
  });
});

describe('resolveEmptyDraftThinkingCurrent', () => {
  test('project pin wins over Pi defaults and the leftover chip', () => {
    expect(resolveEmptyDraftThinkingCurrent({
      projectVariant: 'high',
      defaultsThinking: 'low',
      current: 'medium',
    })).toBe('high');
  });

  test('Pi defaults win when the project has no pin', () => {
    expect(resolveEmptyDraftThinkingCurrent({
      projectVariant: undefined,
      defaultsThinking: 'low',
      current: 'medium',
    })).toBe('low');
    expect(resolveEmptyDraftThinkingCurrent({
      projectVariant: '模型默认',
      defaultsThinking: 'low',
      current: 'medium',
    })).toBe('low');
  });

  test('does not invent medium when nothing is saved', () => {
    expect(resolveEmptyDraftThinkingCurrent({
      projectVariant: undefined,
      defaultsThinking: undefined,
      current: undefined,
    })).toBe(undefined);
  });
});

describe('resolveComposerSendThinking', () => {
  test('sends the chip level even when leftover variant is empty', () => {
    expect(resolveComposerSendThinking({ chipLevel: 'high', variant: undefined })).toBe('high');
  });

  test('falls back to leftover variant off Pi when the chip has not painted', () => {
    expect(resolveComposerSendThinking({ chipLevel: undefined, variant: 'low' })).toBe('low');
  });

  test('does not send leftover OpenCode variant on Pi', () => {
    expect(resolveComposerSendThinking({
      isPiKernel: true,
      chipLevel: undefined,
      variant: 'high',
    })).toBe(undefined);
  });
});

describe('nextCycledPiThinkingLevel', () => {
  test('advances through catalog levels and wraps', () => {
    expect(nextCycledPiThinkingLevel('low', ['low', 'medium', 'high'])).toBe('medium');
    expect(nextCycledPiThinkingLevel('high', ['low', 'medium', 'high'])).toBe('low');
    expect(nextCycledPiThinkingLevel(undefined, ['low', 'medium', 'high'])).toBe('low');
  });
});

describe('unionCurrentIntoPiThinkingLevels', () => {
  test('does not re-add a leftover pin the catalog dropped', () => {
    expect(unionCurrentIntoPiThinkingLevels(
      ['low', 'medium', 'high'],
      'xhigh',
      ['low', 'medium', 'high'],
    )).toEqual(['low', 'medium', 'high']);
  });
});

describe('preferPiModelThinkingLevels', () => {
  const grokCatalog = resolveCatalogThinkingLevels({
    reasoning: true,
    reasoning_options: [{ type: 'effort', values: ['low', 'medium', 'high', 'xhigh'] }],
  });

  test('empty-draft pairing with Pi thinkingLevels does not show models.dev xhigh', () => {
    expect(grokCatalog).toEqual(['low', 'medium', 'high', 'xhigh']);
    const levels = preferPiModelThinkingLevels(
      ['off', 'minimal', 'low', 'medium', 'high'],
      grokCatalog,
    );
    expect(levels).toEqual(['off', 'minimal', 'low', 'medium', 'high']);
    expect(levels).not.toContain('xhigh');
    expect(resolvePairedPiThinking({
      current: 'high',
      catalogLevels: levels,
    })).toEqual({
      thinking: 'high',
      levels: ['off', 'minimal', 'low', 'medium', 'high'],
    });
  });

  test('still shows xhigh when the Pi/SDK list includes it', () => {
    expect(preferPiModelThinkingLevels(
      ['low', 'medium', 'high', 'xhigh'],
      ['low', 'medium', 'high'],
    )).toEqual(['low', 'medium', 'high', 'xhigh']);
    expect(resolvePairedPiThinking({
      current: 'xhigh',
      catalogLevels: ['low', 'medium', 'high', 'xhigh'],
    })).toEqual({
      thinking: 'xhigh',
      levels: ['low', 'medium', 'high', 'xhigh'],
    });
  });

  test('falls back to models.dev only when Pi omitted a list', () => {
    expect(preferPiModelThinkingLevels(undefined, grokCatalog)).toEqual(grokCatalog);
    expect(preferPiModelThinkingLevels([], grokCatalog)).toEqual(grokCatalog);
  });
});

describe('resolveTranscriptThinkingLabel', () => {
  test('prefers thinking then variant then model.variant', () => {
    expect(resolveTranscriptThinkingLabel({
      thinking: 'xhigh',
      variant: 'medium',
      modelVariant: 'low',
    })).toBe('xhigh');
    expect(resolveTranscriptThinkingLabel({
      thinking: undefined,
      variant: 'high',
    })).toBe('high');
    expect(resolveTranscriptThinkingLabel({
      modelVariant: 'max',
    })).toBe('max');
    expect(resolveTranscriptThinkingLabel({
      variant: 'Default',
    })).toBe(undefined);
  });
});
