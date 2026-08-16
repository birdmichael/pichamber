import { describe, expect, test } from 'bun:test';

import { dict as enDict } from './en';
import { dict as esDict } from './es';
import { dict as deDict } from './de';
import { dict as frDict } from './fr';
import { dict as jaDict } from './ja';
import { dict as koDict } from './ko';
import { dict as plDict } from './pl';
import { dict as ptBrDict } from './pt-BR';
import { dict as ukDict } from './uk';
import { dict as zhCnDict } from './zh-CN';
import { dict as zhTwDict } from './zh-TW';

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

describe('Pi header instance translations', () => {
  test('names the current instance and omits Usage and MCP', () => {
    const leftoverUsageOrMcp = /MCP|usage|用量|使用量|Nutzung|utilisation|użycie|використання|사용량/i;

    for (const dictionary of Object.values(localeDictionaries)) {
      const piCopy = dictionary['header.services.openWithCurrentPi'];
      expect(piCopy.includes('{current}')).toBe(true);
      expect(leftoverUsageOrMcp.test(piCopy)).toBe(false);

      const openCodeCopy = dictionary['header.services.openWithCurrent'];
      expect(openCodeCopy.includes('{current}')).toBe(true);
      expect(openCodeCopy.includes('MCP')).toBe(true);

      expect(leftoverUsageOrMcp.test(dictionary['header.services.openPi'])).toBe(false);
      expect(dictionary['header.services.openPiWithMcp'].includes('MCP')).toBe(true);
    }
  });
});
