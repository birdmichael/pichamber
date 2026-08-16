import { describe, expect, test } from 'bun:test';
import {
  escapeSettingsItemSelector,
  querySettingsItem,
  resolveSettingsSearchHighlightId,
  settingsSearchPreparesEntityDraft,
} from './chrome';

describe('settings chrome', () => {
  test('keeps Skills Catalog search from opening a new skill draft', () => {
    expect(settingsSearchPreparesEntityDraft({
      id: 'skills.catalog.search',
      page: 'skills.catalog',
    })).toBe(false);
    expect(settingsSearchPreparesEntityDraft({
      id: 'skills.create',
      page: 'skills.installed',
    })).toBe(true);
  });

  test('maps create-search hits to the field that appears after the page opens', () => {
    expect(resolveSettingsSearchHighlightId({ id: 'skills.create' })).toBe('skills.basic-information');
    expect(resolveSettingsSearchHighlightId({ id: 'commands.create' })).toBe('commands.name');
    expect(resolveSettingsSearchHighlightId({ id: 'commands.template' })).toBe('commands.template');
    expect(resolveSettingsSearchHighlightId({ id: 'plugins.create' })).toBe('plugins.spec');
  });

  test('finds a settings item by escaped id', () => {
    const root = {
      querySelector: (selector: string) => {
        expect(selector).toBe(`[data-settings-item="${escapeSettingsItemSelector('skills.basic-information')}"]`);
        return { id: 'hit' };
      },
    } as unknown as ParentNode;

    expect(querySettingsItem(root, 'skills.basic-information')).toEqual({ id: 'hit' } as unknown as HTMLElement);
    expect(querySettingsItem(null, 'skills.basic-information')).toBeNull();
  });
});
