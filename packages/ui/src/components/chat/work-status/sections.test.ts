import { describe, expect, test } from 'bun:test';
import {
  WORK_STATUS_SECTION_IDS,
  WORK_STATUS_SECTION_LABEL_KEYS,
  areAllWorkStatusSectionsHidden,
  getAvailableWorkStatusSectionIds,
  getWorkStatusPanelPresentation,
  isWorkStatusSectionAvailable,
  isWorkStatusSectionVisible,
  sanitizeWorkStatusHiddenSections,
} from './sections';

describe('section registry', () => {
  test('every section has a label, and every label a section', () => {
    // One list drives the panel and the dialog; a mismatch means a section the
    // user cannot switch, or a switch for nothing.
    expect(Object.keys(WORK_STATUS_SECTION_LABEL_KEYS).sort())
      .toEqual([...WORK_STATUS_SECTION_IDS].sort());
  });
});

describe('isWorkStatusSectionAvailable', () => {
  test('hides the OpenCode provider-quota section on Pi', () => {
    expect(isWorkStatusSectionAvailable('usage', { isPiKernel: true })).toBe(false);
    expect(isWorkStatusSectionAvailable('session', { isPiKernel: true })).toBe(true);
    expect(isWorkStatusSectionAvailable('usage', { isPiKernel: false })).toBe(true);
    expect(isWorkStatusSectionAvailable('usage')).toBe(true);
  });

  test('keeps session context on the available list for Pi', () => {
    expect(getAvailableWorkStatusSectionIds({ isPiKernel: true })).not.toContain('usage');
    expect(getAvailableWorkStatusSectionIds({ isPiKernel: true })).toContain('session');
    expect(getAvailableWorkStatusSectionIds({ isPiKernel: false })).toEqual(WORK_STATUS_SECTION_IDS);
  });

  test('hides MCP on Pi until the adapter slot is installed and enabled', () => {
    expect(isWorkStatusSectionAvailable('mcp', { isPiKernel: true })).toBe(false);
    expect(isWorkStatusSectionAvailable('mcp', { isPiKernel: true, isMcpFeaturePluginActive: false })).toBe(false);
    expect(isWorkStatusSectionAvailable('mcp', { isPiKernel: true, isMcpFeaturePluginActive: true })).toBe(true);
    expect(isWorkStatusSectionAvailable('mcp', { isPiKernel: false })).toBe(true);
    expect(getAvailableWorkStatusSectionIds({ isPiKernel: true })).not.toContain('mcp');
    expect(getAvailableWorkStatusSectionIds({ isPiKernel: true, isMcpFeaturePluginActive: true })).toContain('mcp');
  });
});

describe('isWorkStatusSectionVisible', () => {
  test('everything is visible by default', () => {
    // Storing the hidden set means a section added later is on for everyone,
    // rather than invisible to whoever had settings saved before it existed.
    expect(isWorkStatusSectionVisible([], 'usage')).toBe(true);
    expect(isWorkStatusSectionVisible(undefined, 'usage')).toBe(true);
    expect(isWorkStatusSectionVisible(null, 'usage')).toBe(true);
  });

  test('hides exactly the listed section', () => {
    expect(isWorkStatusSectionVisible(['usage'], 'usage')).toBe(false);
    expect(isWorkStatusSectionVisible(['usage'], 'tasks')).toBe(true);
  });

  test('never shows provider usage on Pi, even when the hidden set is empty', () => {
    expect(isWorkStatusSectionVisible([], 'usage', { isPiKernel: true })).toBe(false);
    expect(isWorkStatusSectionVisible([], 'session', { isPiKernel: true })).toBe(true);
  });
});

describe('areAllWorkStatusSectionsHidden', () => {
  test('returns false when no sections are hidden', () => {
    expect(areAllWorkStatusSectionsHidden([])).toBe(false);
  });

  test('returns false for null and undefined', () => {
    expect(areAllWorkStatusSectionsHidden(null)).toBe(false);
    expect(areAllWorkStatusSectionsHidden(undefined)).toBe(false);
  });

  test('returns false when only some sections are hidden', () => {
    expect(areAllWorkStatusSectionsHidden(['usage', 'tasks'])).toBe(false);
  });

  test('returns true when every known section is hidden', () => {
    expect(areAllWorkStatusSectionsHidden([...WORK_STATUS_SECTION_IDS])).toBe(true);
  });

  test('ignores stale ids that are no longer in the section list', () => {
    // A future section-ID removal should not trick the length check into
    // reporting all-hidden when real sections are still visible.
    const withStale = [...WORK_STATUS_SECTION_IDS.slice(0, -1), 'removed_section'];
    expect(areAllWorkStatusSectionsHidden(withStale)).toBe(false);
  });

  test('returns true even with extra stale ids alongside all real ones', () => {
    const withExtra = [...WORK_STATUS_SECTION_IDS, 'removed_section'];
    expect(areAllWorkStatusSectionsHidden(withExtra)).toBe(true);
  });

  test('on Pi, ignores the unavailable provider-usage section', () => {
    const piSections = WORK_STATUS_SECTION_IDS.filter((id) => id !== 'usage' && id !== 'mcp');
    expect(areAllWorkStatusSectionsHidden(piSections, { isPiKernel: true })).toBe(true);
    expect(areAllWorkStatusSectionsHidden(piSections, { isPiKernel: false })).toBe(false);
    expect(areAllWorkStatusSectionsHidden([], { isPiKernel: true })).toBe(false);
  });
});

describe('getWorkStatusPanelPresentation', () => {
  test('keeps a visible all-hidden panel interactive and renders its recovery state', () => {
    expect(getWorkStatusPanelPresentation({
      visible: true,
      contentMounted: true,
      renderedSections: 0,
      allSectionsHidden: true,
    })).toEqual({ interactive: true, showEmptyState: true });
  });

  test('covers the optimistic fresh-mount count when all sections are hidden', () => {
    expect(getWorkStatusPanelPresentation({
      visible: true,
      contentMounted: true,
      renderedSections: 1,
      allSectionsHidden: true,
    })).toEqual({ interactive: true, showEmptyState: true });
  });

  test('preserves collapse when no section has data but sections remain enabled', () => {
    expect(getWorkStatusPanelPresentation({
      visible: true,
      contentMounted: true,
      renderedSections: 0,
      allSectionsHidden: false,
    })).toEqual({ interactive: false, showEmptyState: false });
  });

  test('does not expose controls or the empty state during a hidden collapse', () => {
    expect(getWorkStatusPanelPresentation({
      visible: false,
      contentMounted: false,
      renderedSections: 0,
      allSectionsHidden: true,
    })).toEqual({ interactive: false, showEmptyState: false });
  });
});

describe('sanitizeWorkStatusHiddenSections', () => {
  test('keeps known ids and drops everything else', () => {
    expect(sanitizeWorkStatusHiddenSections(['usage', 'nope', 42, null, 'tasks']))
      .toEqual(['usage', 'tasks']);
  });

  test('deduplicates', () => {
    expect(sanitizeWorkStatusHiddenSections(['usage', 'usage'])).toEqual(['usage']);
  });

  test('treats a non-array payload as no preference', () => {
    expect(sanitizeWorkStatusHiddenSections(undefined)).toEqual([]);
    expect(sanitizeWorkStatusHiddenSections('usage')).toEqual([]);
    expect(sanitizeWorkStatusHiddenSections({ usage: true })).toEqual([]);
  });
});
