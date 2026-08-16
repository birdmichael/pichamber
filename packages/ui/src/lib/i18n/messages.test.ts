import { describe, expect, test } from 'bun:test';

import { dict as enDict } from './messages/en';
import { dict as esDict } from './messages/es';
import { dict as deDict } from './messages/de';
import { dict as frDict } from './messages/fr';
import { dict as jaDict } from './messages/ja';
import { dict as koDict } from './messages/ko';
import { dict as plDict } from './messages/pl';
import { dict as ptBrDict } from './messages/pt-BR';
import { dict as ukDict } from './messages/uk';
import { dict as zhCnDict } from './messages/zh-CN';
import { dict as zhTwDict } from './messages/zh-TW';

const localeDictionaries = {
  en: enDict,
  de: deDict,
  fr: frDict,
  es: esDict,
  ja: jaDict,
  'pt-BR': ptBrDict,
  uk: ukDict,
  ko: koDict,
  pl: plDict,
  'zh-CN': zhCnDict,
  'zh-TW': zhTwDict,
} as const;

describe('i18n dictionaries', () => {
  test('all locales stay in key parity with english', () => {
    const englishKeys = Object.keys(enDict).sort();

    for (const dictionary of Object.values(localeDictionaries)) {
      expect(Object.keys(dictionary).sort()).toEqual(englishKeys);
    }
  });

  test('all locales expose language label keys', () => {
    for (const [, dictionary] of Object.entries(localeDictionaries)) {
      expect(dictionary['common.language.german']).toBeTruthy();
      expect(dictionary['common.language.french']).toBeTruthy();
      expect(dictionary['common.language.japanese']).toBeTruthy();
    }
  });

  test('Pi header instance copy names the current instance and omits Usage and MCP', () => {
    const leftoverUsageOrMcp = /MCP|usage|用量|使用量|Nutzung|utilisation|użycie|використання|사용량/i;

    for (const [locale, dictionary] of Object.entries(localeDictionaries)) {
      const piCopy = dictionary['header.services.openWithCurrentPi'];
      expect(piCopy, locale).toContain('{current}');
      expect(piCopy, locale).not.toMatch(leftoverUsageOrMcp);

      const openCodeCopy = dictionary['header.services.openWithCurrent'];
      expect(openCodeCopy, locale).toContain('{current}');
      expect(openCodeCopy, locale).toMatch(/MCP/);
    }
  });

  test('empty-session draft titles stay native and keep {project}', () => {
    const englishTitle = enDict['chat.emptyState.draftTitle'];
    const englishTitleWithProject = enDict['chat.emptyState.draftTitleWithProject'];

    expect(englishTitle).toBe('What are we working on?');
    expect(englishTitleWithProject).toBe('What are we working on in {project}?');

    for (const [locale, dictionary] of Object.entries(localeDictionaries)) {
      if (locale === 'en') continue;
      expect(dictionary['chat.emptyState.draftTitle']).not.toBe(englishTitle);
      expect(dictionary['chat.emptyState.draftTitleWithProject']).not.toBe(englishTitleWithProject);
      expect(dictionary['chat.emptyState.draftTitleWithProject']).toContain('{project}');
    }
  });

  test('command palette copy describes sessions, actions, and files', () => {
    expect(enDict['commandPalette.description']).toBe('Search sessions, actions, and files.');
    expect(enDict['commandPalette.input.placeholder']).toBe('Search sessions, actions, files...');

    for (const dictionary of Object.values(localeDictionaries)) {
      expect(dictionary['commandPalette.description']).not.toBe('Search files, sessions, and commands.');
      expect(dictionary['commandPalette.input.placeholder']).not.toBe('Search files, sessions, commands...');
    }
  });
});
