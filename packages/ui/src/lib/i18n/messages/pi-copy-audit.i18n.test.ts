import { describe, expect, test } from 'bun:test';

import { dict as deDict } from './de';
import { dict as enDict } from './en';
import { dict as esDict } from './es';
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

const PI_VISIBLE_KEYS = [
  'settings.view.nav.group.opencode',
  'settings.view.actions.reloadOpenCode',
  'settings.view.actions.reloadOpenCodeTooltip',
  'settings.mcp.page.auth.waitingForOpenCode',
  'settings.openchamber.defaults.summaryOpenCodeDefault',
] as const;

const OPENCODE_KERNEL_LOCATION_KEYS = [
  'settings.skills.location.option.userOpencode.label',
  'settings.skills.location.option.userOpencode.description',
  'settings.skills.location.option.projectOpencode.label',
  'settings.skills.location.option.projectOpencode.description',
] as const;

const MOBILE_CHROME_KEYS = [
  'mobile.connect.welcome.title',
  'mobile.connect.password.placeholder',
  'mobile.connect.scan.invalid',
  'mobile.connect.relay.badge',
  'mobile.connect.error.unreachable',
  'mobile.menu.instances',
] as const;

describe('Pi copy audit', () => {
  test('Settings Pi group and reload/wait/default strings say Pi in every locale', () => {
    for (const [locale, dictionary] of Object.entries(localeDictionaries)) {
      expect(dictionary['settings.view.nav.group.opencode'], locale).toBe('Pi');

      for (const key of PI_VISIBLE_KEYS) {
        const value = dictionary[key];
        expect(value, `${locale} ${key}`).toContain('Pi');
        expect(value, `${locale} ${key}`).not.toContain('OpenCode');
      }
    }
  });

  test('leftover OpenCode skill-location strings stay OpenCode for the OpenCode kernel', () => {
    for (const [locale, dictionary] of Object.entries(localeDictionaries)) {
      for (const key of OPENCODE_KERNEL_LOCATION_KEYS) {
        expect(dictionary[key], `${locale} ${key}`).toContain('OpenCode');
        expect(dictionary[key], `${locale} ${key}`).not.toContain('Pi');
      }
    }
  });

  test('mobile Git tab reuses the Desktop Git product name', () => {
    for (const [locale, dictionary] of Object.entries(localeDictionaries)) {
      expect(dictionary['layout.rightSidebar.git'], locale).toBe('Git');
      expect(dictionary['mobile.menu.changes'], locale).toBe(dictionary['layout.rightSidebar.git']);
      expect(dictionary['mobile.nav.changes'], locale).toBe(dictionary['layout.rightSidebar.git']);
    }
  });

  test('mobile session chrome reuses Desktop sidebar keys for shared actions', () => {
    const sharedKeys = [
      'sessions.sidebar.nav.archive',
      'sessions.sidebar.footer.actions.refresh',
      'sessions.sidebar.header.actions.scheduledTasks',
      'sessions.sidebar.header.actions.newMultiRun',
      'sessions.sidebar.session.untitled',
    ] as const;

    for (const [locale, dictionary] of Object.entries(localeDictionaries)) {
      for (const key of sharedKeys) {
        expect(dictionary[key], `${locale} ${key}`).toBeTruthy();
      }
      expect(dictionary['mobile.menu.instances'], locale).toBeTruthy();
      expect(dictionary['mobile.menu.instances'], locale).not.toBe(
        dictionary['settings.page.remoteInstances.title'],
      );
    }
  });

  test('mobile chrome does not reintroduce OpenChamber', () => {
    for (const [locale, dictionary] of Object.entries(localeDictionaries)) {
      for (const key of MOBILE_CHROME_KEYS) {
        expect(dictionary[key], `${locale} ${key}`).not.toContain('OpenChamber');
      }
      expect(dictionary['mobile.connect.welcome.title'], locale).toContain('Pichamber');
    }
  });
});
