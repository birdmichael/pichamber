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

  test('plan-ready decision chrome is translated in zh-CN', () => {
    expect(zhCnDict['chat.piPlan.enabledNotify']).not.toBe(enDict['chat.piPlan.enabledNotify']);
    expect(zhCnDict['chat.piPlan.readySelect.title']).not.toBe(enDict['chat.piPlan.readySelect.title']);
    expect(zhCnDict['chat.piPlan.readySelect.implementFresh']).not.toBe(enDict['chat.piPlan.readySelect.implementFresh']);
    expect(zhCnDict['chat.tool.planModeComplete']).not.toBe(enDict['chat.tool.planModeComplete']);
    expect(zhCnDict['chat.piPlan.readySelect.title']).toContain('/plan exit');
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

  test('composer @/# empty states name files/agents or snippets, and add snippet has no extra plus', () => {
    expect(enDict['chat.fileMentionAutocomplete.empty']).toBe('No files or agents found');
    expect(enDict['chat.snippetAutocomplete.empty']).toBe('No snippets found');
    expect(enDict['chat.snippetAutocomplete.action.addNew']).toBe('Add new snippet');

    for (const [locale, dictionary] of Object.entries(localeDictionaries)) {
      expect(dictionary['chat.snippetAutocomplete.action.addNew'], locale).not.toMatch(/^\s*\+/);
      expect(dictionary['chat.fileMentionAutocomplete.empty'], locale).not.toBe('No matches found');
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

  test('Chinese locales keep git worktree as a loanword', () => {
    const worktreeTerm = /\bworktrees?\b/i;
    const workingTreeTerm = /working[-\s]?tree/i;
    const chineseTreeCalque = /工作树|工作樹/;
    const polishTreeCalque = /drzewo pracy|drzewa pracy|drzewie pracy/i;

    const worktreeKeys = Object.keys(enDict).filter((key) => {
      const english = enDict[key as keyof typeof enDict];
      return worktreeTerm.test(english) && !workingTreeTerm.test(english);
    });

    expect(worktreeKeys.length).toBeGreaterThan(20);

    for (const key of worktreeKeys) {
      const typedKey = key as keyof typeof enDict;
      expect(zhCnDict[typedKey], `zh-CN ${key}`).not.toMatch(chineseTreeCalque);
      expect(zhTwDict[typedKey], `zh-TW ${key}`).not.toMatch(chineseTreeCalque);
      expect(zhCnDict[typedKey], `zh-CN ${key}`).toMatch(/worktree/i);
      expect(zhTwDict[typedKey], `zh-TW ${key}`).toMatch(/worktree/i);
      expect(plDict[typedKey], `pl ${key}`).not.toMatch(polishTreeCalque);
    }

    expect(zhCnDict['chat.chatInput.worktrees']).toBe('worktree');
    expect(zhCnDict['chat.chatInput.worktreeNew']).toBe('+ 新建');
    expect(zhCnDict['sessions.sidebar.project.actions.newWorktree']).toBe('新建 worktree');
    expect(zhCnDict['sessions.sidebar.session.menu.moveToWorktree']).toBe('移至新 worktree');
    expect(zhCnDict['settings.projects.page.section.worktree']).toBe('worktree');
    expect(zhCnDict['mobile.projectEdit.worktreesTitle']).toBe('worktree');
    expect(zhTwDict['sessions.sidebar.session.menu.moveToWorktree']).toBe('移至新 worktree');

    expect(zhCnDict['contextRail.editorTree.toggle']).toBe('切换文件树');
    expect(zhCnDict['contextPanel.editorEmpty.description']).toContain('文件树');
    expect(zhCnDict['filesView.editor.pickFileFromTree']).toContain('文件树');
    expect(enDict['contextRail.editorTree.toggle']).toBe('Toggle file tree');
    expect(enDict['settings.openchamber.git.option.treeView']).toBe('Tree View');
    expect(zhCnDict['settings.openchamber.git.option.treeView']).toBe('树形视图');
  });
});
