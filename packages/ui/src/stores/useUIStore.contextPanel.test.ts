import { beforeEach, describe, expect, test } from 'bun:test';
import { CHAT_DRAFT_PROJECT_ID } from '../lib/chatDirectories';
import { CONTEXT_SURFACES, sortContextSurfaces } from '../lib/surfaces/registry';
import { useDirectoryStore } from './useDirectoryStore';
import { useProjectsStore } from './useProjectsStore';
import { useUIStore } from './useUIStore';

beforeEach(() => {
  useUIStore.setState({ contextPanelByDirectory: {}, contextRailOrder: [], contextRailHiddenSurfaces: [] });
  useDirectoryStore.setState({ homeDirectory: '/Users/tester' });
  useProjectsStore.setState({ projects: [] });
});

describe('useUIStore context panel tabs', () => {
  test('updates readOnly when an existing chat tab is reopened', () => {
    const directory = '/repo';

    useUIStore.getState().openContextPanelTab(directory, {
      mode: 'chat',
      dedupeKey: 'session:ses_1',
      label: 'Session',
      readOnly: true,
    });

    useUIStore.getState().openContextPanelTab(directory, {
      mode: 'chat',
      dedupeKey: 'session:ses_1',
      label: 'Session',
      readOnly: false,
    });

    const tabs = useUIStore.getState().contextPanelByDirectory[directory]?.tabs ?? [];
    expect(tabs).toHaveLength(1);
    expect(tabs[0]?.readOnly).toBe(false);
  });

  test('stores a parent-scoped chat tab on the session key, not the project directory', () => {
    const directory = '/repo';

    useUIStore.getState().openContextPanelTab(directory, {
      mode: 'chat',
      dedupeKey: 'session:child-a',
      label: 'scout A',
      sessionScope: 'session:parent-a',
    });
    useUIStore.getState().openContextPanelTab(directory, {
      mode: 'chat',
      dedupeKey: 'session:child-b',
      label: 'scout B',
      sessionScope: 'session:parent-b',
    });

    const byDirectory = useUIStore.getState().contextPanelByDirectory;
    expect(byDirectory['session:parent-a']?.tabs.map((tab) => tab.id)).toEqual(['chat:session:child-a']);
    expect(byDirectory['session:parent-b']?.tabs.map((tab) => tab.id)).toEqual(['chat:session:child-b']);
    expect(byDirectory[directory]?.tabs.some((tab) => tab.mode === 'chat')).toBe(false);
    expect(byDirectory[directory]?.isOpen).toBe(true);
    expect(byDirectory[directory]?.activeTabId).toBe('chat:session:child-b');
  });

  test('opening a worktree child focuses the parent-scoped chat tab', () => {
    useUIStore.getState().openContextPanelTab('/repo', { mode: 'file', targetPath: '/repo/a.ts' });
    useUIStore.getState().openContextPanelTab('/repo-worktree', {
      mode: 'chat',
      dedupeKey: 'session:child-b',
      label: 'scout-b',
      sessionScope: 'session:parent-a',
    });

    const scope = useUIStore.getState().contextPanelByDirectory['session:parent-a'];
    expect(scope?.tabs.map((tab) => tab.id)).toEqual(['chat:session:child-b']);
    expect(scope?.activeTabId).toBe('chat:session:child-b');
    expect(scope?.isOpen).toBe(true);
  });
});

describe('useUIStore closeContextPanel dismisses session-scoped child chats', () => {
  test('X / closeContextPanel closes the parent-scoped child panel, not only the project key', () => {
    const directory = '/repo';

    useUIStore.getState().openContextPanelTab(directory, {
      mode: 'chat',
      dedupeKey: 'session:child-a',
      label: 'scout A',
      sessionScope: 'session:parent-a',
    });
    useUIStore.getState().openContextPanelTab(directory, {
      mode: 'chat',
      dedupeKey: 'session:child-b',
      label: 'scout B',
      sessionScope: 'session:parent-a',
    });

    expect(useUIStore.getState().contextPanelByDirectory['session:parent-a']?.isOpen).toBe(true);
    expect(useUIStore.getState().contextPanelByDirectory[directory]?.isOpen).toBe(true);

    useUIStore.getState().closeContextPanel(directory);

    const byDirectory = useUIStore.getState().contextPanelByDirectory;
    expect(byDirectory[directory]?.isOpen).toBe(false);
    expect(byDirectory['session:parent-a']?.isOpen).toBe(false);
    // Tabs stay so Work Status can reopen them; the panel itself is dismissed.
    expect(byDirectory['session:parent-a']?.tabs.map((tab) => tab.id)).toEqual([
      'chat:session:child-a',
      'chat:session:child-b',
    ]);
  });

  test('closeContextPanel on the session key alone dismisses the child panel', () => {
    const directory = '/repo';
    useUIStore.getState().openContextPanelTab(directory, {
      mode: 'chat',
      dedupeKey: 'session:child-a',
      label: 'scout A',
      sessionScope: 'session:parent-a',
    });

    useUIStore.getState().closeContextPanel('session:parent-a');

    expect(useUIStore.getState().contextPanelByDirectory['session:parent-a']?.isOpen).toBe(false);
  });

});

describe('useUIStore openContextSurface', () => {
  const directory = '/repo';

  test('opens a fresh singleton tab when none of that mode exists', () => {
    useUIStore.getState().openContextSurface(directory, 'diff');

    const state = useUIStore.getState().contextPanelByDirectory[directory];
    expect(state?.isOpen).toBe(true);
    expect(state?.tabs.map((tab) => tab.mode)).toEqual(['diff']);
  });

  test('activates the existing tab of the requested mode instead of duplicating it', () => {
    useUIStore.getState().openContextPanelTab(directory, { mode: 'diff' });
    useUIStore.getState().openContextPanelTab(directory, { mode: 'file', targetPath: '/repo/a.ts' });

    useUIStore.getState().openContextSurface(directory, 'diff');

    const state = useUIStore.getState().contextPanelByDirectory[directory];
    expect(state?.tabs.filter((tab) => tab.mode === 'diff')).toHaveLength(1);
    expect(state?.activeTabId).toBe('diff');
    expect(state?.isOpen).toBe(true);
  });

  test('toggles the panel closed when the requested mode is already active and open', () => {
    useUIStore.getState().openContextSurface(directory, 'diff');
    useUIStore.getState().openContextSurface(directory, 'diff');

    const state = useUIStore.getState().contextPanelByDirectory[directory];
    expect(state?.isOpen).toBe(false);
    expect(state?.tabs.map((tab) => tab.mode)).toEqual(['diff']);
  });

  test('does nothing for content-driven modes without existing content', () => {
    useUIStore.getState().openContextSurface(directory, 'chat');

    expect(useUIStore.getState().contextPanelByDirectory[directory]).toBe(undefined);
  });

  test('still opens pull request and walkthrough when those surfaces are invoked', () => {
    useUIStore.getState().openContextSurface(directory, 'pr');
    expect(useUIStore.getState().contextPanelByDirectory[directory]?.tabs.map((tab) => tab.mode)).toEqual(['pr']);

    useUIStore.getState().openContextSurface(directory, 'walkthrough');
    const tabs = useUIStore.getState().contextPanelByDirectory[directory]?.tabs ?? [];
    expect(tabs.map((tab) => tab.mode)).toEqual(['pr', 'walkthrough']);
    expect(useUIStore.getState().contextPanelByDirectory[directory]?.activeTabId).toBe('walkthrough');
  });

  test('opens an empty editor tab that a real file later replaces', () => {
    useUIStore.getState().openContextSurface(directory, 'file');

    let state = useUIStore.getState().contextPanelByDirectory[directory];
    expect(state?.isOpen).toBe(true);
    expect(state?.tabs.map((tab) => tab.mode)).toEqual(['file']);
    expect(state?.tabs[0]?.targetPath).toBe(null);

    useUIStore.getState().openContextFile(directory, '/repo/a.ts');

    state = useUIStore.getState().contextPanelByDirectory[directory];
    expect(state?.tabs.filter((tab) => tab.mode === 'file')).toHaveLength(1);
    expect(state?.tabs.find((tab) => tab.mode === 'file')?.targetPath).toBe('/repo/a.ts');
  });

  test('activates the most recently touched tab of a content-driven mode', () => {
    useUIStore.getState().openContextFile(directory, '/repo/a.ts');
    useUIStore.getState().openContextFile(directory, '/repo/b.ts');
    useUIStore.getState().openContextPanelTab(directory, { mode: 'diff' });

    useUIStore.getState().openContextSurface(directory, 'file');

    const state = useUIStore.getState().contextPanelByDirectory[directory];
    const activeTab = state?.tabs.find((tab) => tab.id === state.activeTabId);
    expect(activeTab?.mode).toBe('file');
    expect(activeTab?.targetPath).toBe('/repo/b.ts');
  });
});

describe('useUIStore closeContextPanelTab surface stability', () => {
  const directory = '/repo';

  test('closing an active file tab activates another file tab, not another surface', () => {
    useUIStore.getState().openContextPanelTab(directory, { mode: 'terminal' });
    useUIStore.getState().openContextFile(directory, '/repo/a.ts');
    useUIStore.getState().openContextFile(directory, '/repo/b.ts');

    const stateBefore = useUIStore.getState().contextPanelByDirectory[directory];
    const activeTabId = stateBefore?.activeTabId as string;
    useUIStore.getState().closeContextPanelTab(directory, activeTabId);

    const state = useUIStore.getState().contextPanelByDirectory[directory];
    const activeTab = state?.tabs.find((tab) => tab.id === state.activeTabId);
    expect(activeTab?.mode).toBe('file');
    expect(activeTab?.targetPath).toBe('/repo/a.ts');
    expect(state?.isOpen).toBe(true);
  });

  test('closing the last tab of the active surface closes the panel', () => {
    useUIStore.getState().openContextPanelTab(directory, { mode: 'terminal' });
    useUIStore.getState().openContextFile(directory, '/repo/a.ts');

    const stateBefore = useUIStore.getState().contextPanelByDirectory[directory];
    useUIStore.getState().closeContextPanelTab(directory, stateBefore?.activeTabId as string);

    const state = useUIStore.getState().contextPanelByDirectory[directory];
    expect(state?.isOpen).toBe(false);
    expect(state?.tabs.map((tab) => tab.mode)).toEqual(['terminal']);
  });

  test('closing an inactive tab keeps the active tab untouched', () => {
    useUIStore.getState().openContextFile(directory, '/repo/a.ts');
    useUIStore.getState().openContextPanelTab(directory, { mode: 'terminal' });

    const state0 = useUIStore.getState().contextPanelByDirectory[directory];
    const fileTab = state0?.tabs.find((tab) => tab.mode === 'file');
    useUIStore.getState().closeContextPanelTab(directory, fileTab?.id as string);

    const state = useUIStore.getState().contextPanelByDirectory[directory];
    expect(state?.activeTabId).toBe('terminal');
    expect(state?.isOpen).toBe(true);
  });
});

describe('useUIStore Plan docks beside chat', () => {
  const directory = '/repo';

  test('opening Plan clears leftover expanded overlay and does not set the plan main tab', () => {
    useUIStore.setState({ activeMainTab: 'chat', isMobile: false });
    useUIStore.getState().openContextSurface(directory, 'file');
    useUIStore.getState().toggleContextPanelExpanded(directory);
    expect(useUIStore.getState().contextPanelByDirectory[directory]?.expanded).toBe(true);

    useUIStore.getState().openContextSurface(directory, 'plan');

    const state = useUIStore.getState().contextPanelByDirectory[directory];
    expect(state?.isOpen).toBe(true);
    expect(state?.expanded).toBe(false);
    expect(state?.tabs.find((tab) => tab.id === state.activeTabId)?.mode).toBe('plan');
    expect(useUIStore.getState().activeMainTab).toBe('chat');
  });

  test('openContextPlan docks even when the directory already stored expanded: true', () => {
    useUIStore.setState({
      isMobile: false,
      activeMainTab: 'chat',
      contextPanelByDirectory: {
        [directory]: {
          isOpen: false,
          expanded: true,
          tabs: [],
          activeTabId: null,
          widthByMode: {},
          touchedAt: Date.now(),
        },
      },
    });

    useUIStore.getState().openContextPlan(directory);

    const state = useUIStore.getState().contextPanelByDirectory[directory];
    expect(state?.isOpen).toBe(true);
    expect(state?.expanded).toBe(false);
    expect(state?.activeTabId).toBe('plan');
    expect(useUIStore.getState().activeMainTab).toBe('chat');
  });

  test('activating an existing Plan tab collapses leftover expanded state', () => {
    useUIStore.getState().openContextPanelTab(directory, { mode: 'plan' });
    useUIStore.getState().openContextSurface(directory, 'diff');
    useUIStore.getState().toggleContextPanelExpanded(directory);
    expect(useUIStore.getState().contextPanelByDirectory[directory]?.expanded).toBe(true);

    useUIStore.getState().openContextSurface(directory, 'plan');

    const state = useUIStore.getState().contextPanelByDirectory[directory];
    expect(state?.isOpen).toBe(true);
    expect(state?.expanded).toBe(false);
    expect(state?.activeTabId).toBe('plan');
  });

  test('toggle expanded is a no-op while Plan is the active surface', () => {
    useUIStore.getState().openContextSurface(directory, 'plan');
    useUIStore.getState().toggleContextPanelExpanded(directory);
    expect(useUIStore.getState().contextPanelByDirectory[directory]?.expanded).toBe(false);
  });

  test('desktop setActiveMainTab(plan) stays on chat; mobile still uses the plan sheet tab', () => {
    useUIStore.setState({ isMobile: false, activeMainTab: 'chat' });
    useUIStore.getState().setActiveMainTab('plan');
    expect(useUIStore.getState().activeMainTab).toBe('chat');

    useUIStore.setState({ isMobile: true, activeMainTab: 'chat' });
    useUIStore.getState().setActiveMainTab('plan');
    expect(useUIStore.getState().activeMainTab).toBe('plan');
  });
});

describe('useUIStore per-surface panel widths', () => {
  const directory = '/repo';

  test('setContextPanelWidth stores a clamped manual width for one mode only', () => {
    useUIStore.getState().openContextPanelTab(directory, { mode: 'diff' });
    useUIStore.getState().setContextPanelWidth(directory, 'diff', 700);
    useUIStore.getState().setContextPanelWidth(directory, 'git', 100);

    const state = useUIStore.getState().contextPanelByDirectory[directory];
    expect(state?.widthByMode.diff).toBe(700);
    expect(state?.widthByMode.git).toBe(380);
    expect(state?.widthByMode.browser).toBe(undefined);
  });
});

describe('useUIStore contextRailOrder', () => {
  test('setContextRailOrder drops empty and duplicate ids', () => {
    useUIStore.getState().setContextRailOrder(['diff', 'diff', '', 'editor']);
    expect(useUIStore.getState().contextRailOrder).toEqual(['diff', 'editor']);
  });

  test('setContextRailSurfaceVisible stores the hidden set so later surfaces stay visible', () => {
    useUIStore.getState().setContextRailSurfaceVisible('git', false);
    expect(useUIStore.getState().contextRailHiddenSurfaces).toEqual(['git']);
    useUIStore.getState().setContextRailSurfaceVisible('git', false);
    expect(useUIStore.getState().contextRailHiddenSurfaces).toEqual(['git']);
    useUIStore.getState().setContextRailSurfaceVisible('git', true);
    expect(useUIStore.getState().contextRailHiddenSurfaces).toEqual([]);
    useUIStore.getState().setContextRailHiddenSurfaces(['browser', 'browser', 'diff']);
    expect(useUIStore.getState().contextRailHiddenSurfaces).toEqual(['browser', 'diff']);
  });

  test('sortContextSurfaces applies persisted order and appends missing surfaces', () => {
    const ordered = sortContextSurfaces(['browser', 'unknown-id', 'diff']);
    const ids = ordered.map((surface) => surface.id);

    expect(ids.slice(0, 2)).toEqual(['browser', 'diff']);
    // Assert against the registry itself so this test cannot go stale when a
    // surface is added or removed.
    expect(new Set(ids)).toEqual(new Set(CONTEXT_SURFACES.map((surface) => surface.id)));
    expect(ids).toHaveLength(CONTEXT_SURFACES.length);
  });
});

describe('context panel tab limits', () => {
  test('a surface filling up never evicts another surface tab', () => {
    const directory = '/repo';
    useUIStore.getState().openContextDiff(directory, 'src/app.ts');

    for (let index = 0; index < 20; index += 1) {
      useUIStore.getState().openContextPreview(directory, `http://localhost:${3000 + index}/`);
    }

    const tabs = useUIStore.getState().contextPanelByDirectory[directory]?.tabs ?? [];
    // The diff tab is not on screen while browsing, so losing it would be a
    // disappearance the user never saw happen.
    expect(tabs.some((tab) => tab.mode === 'diff')).toBe(true);
    expect(tabs.filter((tab) => tab.mode === 'browser').length).toBeLessThan(20);
  });

  test('keeps the tab that was just opened', () => {
    const directory = '/repo';
    for (let index = 0; index < 20; index += 1) {
      useUIStore.getState().openContextPreview(directory, `http://localhost:${3000 + index}/`);
    }

    const state = useUIStore.getState().contextPanelByDirectory[directory];
    const tabs = state?.tabs ?? [];
    expect(tabs.some((tab) => tab.id === state?.activeTabId)).toBe(true);
    expect(tabs.some((tab) => tab.targetPath === 'http://localhost:3019/')).toBe(true);
  });
});

describe('useUIStore browser project/chats scope', () => {
  const home = '/Users/tester';
  const chatA = `${home}/.config/openchamber/chats/2026-08-25/session-a`;
  const chatB = `${home}/.config/openchamber/chats/2026-08-25/session-b`;
  const projectA = `${home}/project-a`;
  const projectB = `${home}/project-b`;

  test('projectless chats draft key does not read the last project tabs', () => {
    useUIStore.getState().openContextPreview(projectA, 'https://example.com/');
    useUIStore.getState().openContextPreview(projectA, 'https://example.org/');

    useUIStore.getState().openContextSurface(CHAT_DRAFT_PROJECT_ID, 'browser');

    const projectTabs = useUIStore.getState().contextPanelByDirectory[projectA]?.tabs ?? [];
    const draftTabs = useUIStore.getState().contextPanelByDirectory[CHAT_DRAFT_PROJECT_ID]?.tabs ?? [];
    expect(projectTabs.map((tab) => tab.targetPath)).toEqual(['https://example.com/', 'https://example.org/']);
    expect(draftTabs.filter((tab) => tab.mode === 'browser')).toHaveLength(1);
    expect(draftTabs.some((tab) => tab.targetPath === 'https://example.com/' || tab.targetPath === 'https://example.org/')).toBe(false);
  });

  test('two chat sessions share one browser tab set on the chats sentinel', () => {
    useUIStore.getState().openContextPreview(chatA, 'https://example.com/');
    useUIStore.getState().openContextFile(chatA, `${chatA}/notes.md`);

    const chats = useUIStore.getState().contextPanelByDirectory[CHAT_DRAFT_PROJECT_ID];
    const sessionA = useUIStore.getState().contextPanelByDirectory[chatA];
    expect(chats?.tabs.filter((tab) => tab.mode === 'browser')).toHaveLength(1);
    expect(sessionA?.tabs.some((tab) => tab.mode === 'browser')).toBe(false);
    expect(sessionA?.tabs.some((tab) => tab.mode === 'file')).toBe(true);

    useUIStore.getState().openContextSurface(chatB, 'browser');
    const sessionB = useUIStore.getState().contextPanelByDirectory[chatB];
    const sharedBrowser = useUIStore.getState().contextPanelByDirectory[CHAT_DRAFT_PROJECT_ID];
    expect(sharedBrowser?.tabs.filter((tab) => tab.mode === 'browser')).toHaveLength(1);
    expect(sharedBrowser?.tabs[0]?.id).toBe(chats?.tabs[0]?.id);
    expect(sessionB?.tabs.some((tab) => tab.mode === 'browser')).toBe(false);
    expect(sessionB?.isOpen).toBe(true);
    expect(sessionB?.activeTabId).toBe(sharedBrowser?.tabs[0]?.id);
    expect(sessionA?.tabs.some((tab) => tab.mode === 'file')).toBe(true);
  });

  test('project A and project B keep separate browser tabs', () => {
    useUIStore.getState().openContextPreview(projectA, 'https://a.example/');
    useUIStore.getState().openContextPreview(projectB, 'https://b.example/');

    expect(useUIStore.getState().contextPanelByDirectory[projectA]?.tabs.map((tab) => tab.targetPath)).toEqual(['https://a.example/']);
    expect(useUIStore.getState().contextPanelByDirectory[projectB]?.tabs.map((tab) => tab.targetPath)).toEqual(['https://b.example/']);
    expect(useUIStore.getState().contextPanelByDirectory[CHAT_DRAFT_PROJECT_ID]).toBe(undefined);
  });

  test('reopening the browser on the same project directory does not create a chats bucket', () => {
    useUIStore.getState().openContextPreview(projectA, 'https://shared.example/');
    useUIStore.getState().openContextSurface(projectA, 'browser');

    expect(useUIStore.getState().contextPanelByDirectory[projectA]?.tabs.filter((tab) => tab.mode === 'browser')).toHaveLength(1);
    expect(useUIStore.getState().contextPanelByDirectory[CHAT_DRAFT_PROJECT_ID]).toBe(undefined);
  });

  test('moves leftover chat-session browser tabs onto the chats sentinel', () => {
    useUIStore.setState({
      contextPanelByDirectory: {
        [chatA]: {
          isOpen: true,
          expanded: false,
          tabs: [{
            id: 'browser:https://old.example/',
            mode: 'browser',
            targetPath: 'https://old.example/',
            dedupeKey: 'https://old.example/',
            label: null,
            sessionTitleFallback: null,
            readOnly: false,
            stagedDiff: false,
            diffScope: 'working',
            touchedAt: 1,
          }],
          activeTabId: 'browser:https://old.example/',
          widthByMode: {},
          touchedAt: 1,
        },
      },
    });

    useUIStore.getState().openContextPreview(chatA, 'https://new.example/');

    const chats = useUIStore.getState().contextPanelByDirectory[CHAT_DRAFT_PROJECT_ID];
    const sessionA = useUIStore.getState().contextPanelByDirectory[chatA];
    expect(chats?.tabs.map((tab) => tab.targetPath)).toEqual([
      'https://new.example/',
      'https://old.example/',
    ]);
    expect(sessionA?.tabs.some((tab) => tab.mode === 'browser')).toBe(false);
  });

  test('home that is an opened Settings project stays a project scope', () => {
    useProjectsStore.setState({
      projects: [{ id: 'home', path: home, label: 'Home' }],
    });

    useUIStore.getState().openContextPreview(home, 'https://home.example/');

    expect(useUIStore.getState().contextPanelByDirectory[home]?.tabs[0]?.targetPath).toBe('https://home.example/');
    expect(useUIStore.getState().contextPanelByDirectory[CHAT_DRAFT_PROJECT_ID]).toBe(undefined);
  });

  test('persisting a chat browser URL writes the chats bucket, not the session dir', () => {
    useUIStore.getState().openContextPreview(chatA, 'https://start.example/');
    const tabID = useUIStore.getState().contextPanelByDirectory[CHAT_DRAFT_PROJECT_ID]?.tabs[0]?.id as string;

    useUIStore.getState().setContextPanelTabTargetPath(chatA, tabID, 'https://later.example/');

    expect(useUIStore.getState().contextPanelByDirectory[CHAT_DRAFT_PROJECT_ID]?.tabs[0]?.targetPath).toBe('https://later.example/');
    expect(useUIStore.getState().contextPanelByDirectory[chatA]?.tabs).toEqual([]);
  });
});
