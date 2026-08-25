import { beforeEach, describe, expect, test } from 'bun:test';

import { CHAT_DRAFT_PROJECT_ID } from '@/lib/chatDirectories';
import { selectBrowserHistory, useBrowserHistoryStore } from './useBrowserHistoryStore';
import { useDirectoryStore } from './useDirectoryStore';
import { useProjectsStore } from './useProjectsStore';

const HOME = '/Users/tester';
const CHAT_A = `${HOME}/.config/openchamber/chats/2026-08-25/session-a`;
const CHAT_B = `${HOME}/.config/openchamber/chats/2026-08-25/session-b`;
const PROJECT_A = `${HOME}/project-a`;
const PROJECT_B = `${HOME}/project-b`;

beforeEach(() => {
  useBrowserHistoryStore.setState({ byProject: {} });
  useDirectoryStore.setState({ homeDirectory: HOME });
  useProjectsStore.setState({ projects: [] });
});

describe('useBrowserHistoryStore project/chats scope', () => {
  test('collapses isolated chat directories onto one history list', () => {
    useBrowserHistoryStore.getState().recordVisit(CHAT_A, { url: 'https://example.com/', title: 'Example' });
    useBrowserHistoryStore.getState().recordVisit(CHAT_B, { url: 'https://other.example/', title: 'Other' });

    const shared = selectBrowserHistory(CHAT_A)(useBrowserHistoryStore.getState());
    expect(selectBrowserHistory(CHAT_B)(useBrowserHistoryStore.getState())).toBe(shared);
    expect(shared.map((entry) => entry.url)).toEqual(['https://other.example/', 'https://example.com/']);
    expect(selectBrowserHistory(CHAT_DRAFT_PROJECT_ID)(useBrowserHistoryStore.getState())).toBe(shared);
  });

  test('keeps Settings projects split', () => {
    useBrowserHistoryStore.getState().recordVisit(PROJECT_A, { url: 'https://a.example/' });
    useBrowserHistoryStore.getState().recordVisit(PROJECT_B, { url: 'https://b.example/' });

    expect(selectBrowserHistory(PROJECT_A)(useBrowserHistoryStore.getState()).map((entry) => entry.url)).toEqual(['https://a.example/']);
    expect(selectBrowserHistory(PROJECT_B)(useBrowserHistoryStore.getState()).map((entry) => entry.url)).toEqual(['https://b.example/']);
  });

  test('home-as-project is not the chats bucket', () => {
    useProjectsStore.setState({
      projects: [{ id: 'home', path: HOME, label: 'Home' }],
    });

    useBrowserHistoryStore.getState().recordVisit(HOME, { url: 'https://home.example/' });
    useBrowserHistoryStore.getState().recordVisit(CHAT_A, { url: 'https://chat.example/' });

    expect(selectBrowserHistory(HOME)(useBrowserHistoryStore.getState()).map((entry) => entry.url)).toEqual(['https://home.example/']);
    expect(selectBrowserHistory(CHAT_A)(useBrowserHistoryStore.getState()).map((entry) => entry.url)).toEqual(['https://chat.example/']);
  });

  test('home-as-chat shares history with isolated chat directories', () => {
    useBrowserHistoryStore.getState().recordVisit(HOME, { url: 'https://home-chat.example/' });

    expect(selectBrowserHistory(CHAT_A)(useBrowserHistoryStore.getState()).map((entry) => entry.url)).toEqual(['https://home-chat.example/']);
  });
});
