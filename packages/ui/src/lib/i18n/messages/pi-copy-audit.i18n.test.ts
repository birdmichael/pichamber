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
    for (const dictionary of Object.values(localeDictionaries)) {
      expect(dictionary['settings.view.nav.group.opencode']).toBe('Pi');

      for (const key of PI_VISIBLE_KEYS) {
        const value = dictionary[key];
        expect(value.includes('Pi')).toBe(true);
        expect(value.includes('OpenCode')).toBe(false);
      }
    }
  });

  test('leftover OpenCode skill-location strings stay OpenCode for the OpenCode kernel', () => {
    for (const dictionary of Object.values(localeDictionaries)) {
      expect(dictionary['settings.skills.location.option.userOpencode.label'].includes('OpenCode')).toBe(true);
      expect(dictionary['settings.skills.location.option.projectOpencode.label'].includes('OpenCode')).toBe(true);
      expect(/OpenCode|\.opencode/.test(dictionary['settings.skills.location.option.userOpencode.description'])).toBe(true);
      expect(/OpenCode|\.opencode/.test(dictionary['settings.skills.location.option.projectOpencode.description'])).toBe(true);
      for (const key of OPENCODE_KERNEL_LOCATION_KEYS) {
        expect(dictionary[key].includes('Pi')).toBe(false);
      }
    }
  });

  test('mobile Git tab reuses the Desktop Git product name', () => {
    for (const dictionary of Object.values(localeDictionaries)) {
      expect(dictionary['layout.rightSidebar.git']).toBe('Git');
      expect(dictionary['mobile.menu.changes']).toBe(dictionary['layout.rightSidebar.git']);
      expect(dictionary['mobile.nav.changes']).toBe(dictionary['layout.rightSidebar.git']);
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

    for (const dictionary of Object.values(localeDictionaries)) {
      for (const key of sharedKeys) {
        expect(dictionary[key].length > 0).toBe(true);
      }
      expect(dictionary['mobile.menu.instances'].length > 0).toBe(true);
      expect(dictionary['mobile.menu.instances']).not.toBe(
        dictionary['settings.page.remoteInstances.title'],
      );
    }
  });

  test('Pi composer helper placeholders do not promise ! or shell', () => {
    const leftoverShellHelper = /!|shell|シェル|셸|powłok/i;

    for (const dictionary of Object.values(localeDictionaries)) {
      expect(leftoverShellHelper.test(dictionary['chat.chatInput.placeholder.chatPi'])).toBe(false);
      expect(leftoverShellHelper.test(dictionary['chat.chatInput.placeholder.chatCompactPi'])).toBe(false);
      expect(dictionary['chat.chatInput.placeholder.chatPi'].includes('@')).toBe(true);
      expect(dictionary['chat.chatInput.placeholder.chatPi'].includes('/')).toBe(true);
      expect(dictionary['chat.chatInput.placeholder.chatPi'].includes('#')).toBe(true);
      expect(dictionary['chat.chatInput.placeholder.chatCompactPi'].includes('@')).toBe(true);
      expect(dictionary['chat.chatInput.placeholder.chatCompactPi'].includes('/')).toBe(true);
      expect(dictionary['chat.chatInput.placeholder.chatCompactPi'].includes('#')).toBe(true);

      expect(dictionary['chat.chatInput.placeholder.chat'].includes('!')).toBe(true);
      expect(dictionary['chat.chatInput.placeholder.chatCompact'].includes('!')).toBe(true);
    }
  });

  test('mobile chrome does not reintroduce OpenChamber', () => {
    for (const dictionary of Object.values(localeDictionaries)) {
      for (const key of MOBILE_CHROME_KEYS) {
        expect(dictionary[key].includes('OpenChamber')).toBe(false);
      }
      expect(dictionary['mobile.connect.welcome.title'].includes('Pichamber')).toBe(true);
    }
  });
});
