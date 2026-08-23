import { describe, expect, test } from 'bun:test';
import {
  findOpenedProjectForDirectory,
  getProjectDisplayLabel,
  resolveWelcomeWorkspaceLabel,
} from './workspaceLabel';

const HOME = '/home/box';
const PICHAMBER = '/home/box/pichamber';

const homeProject = { id: 'home', path: HOME };
const pichamberProject = { id: 'pichamber', path: PICHAMBER, label: 'pichamber' };
const projects = [homeProject, pichamberProject];

describe('getProjectDisplayLabel', () => {
  test('uses ~ for the home folder when homeDirectory is known', () => {
    expect(getProjectDisplayLabel(homeProject, HOME)).toBe('~');
  });

  test('does not use a raw last-segment folder when the path is home', () => {
    expect(getProjectDisplayLabel(homeProject, HOME)).not.toBe('box');
  });

  test('uses the last path segment for a project that is not home', () => {
    expect(getProjectDisplayLabel({ path: PICHAMBER }, HOME)).toBe('pichamber');
  });

  test('prefers an explicit project label', () => {
    expect(getProjectDisplayLabel({ path: HOME, label: 'Home' }, HOME)).toBe('Home');
    expect(getProjectDisplayLabel(pichamberProject, HOME)).toBe('pichamber');
  });
});

describe('findOpenedProjectForDirectory', () => {
  test('matches an opened project at its own root', () => {
    expect(findOpenedProjectForDirectory(projects, PICHAMBER)).toEqual(pichamberProject);
    expect(findOpenedProjectForDirectory(projects, HOME)).toEqual(homeProject);
  });

  test('prefers the longest matching opened project', () => {
    expect(findOpenedProjectForDirectory(projects, `${PICHAMBER}/packages/ui`)).toEqual(pichamberProject);
  });

  test('returns null when the directory is not inside an opened project', () => {
    expect(findOpenedProjectForDirectory([pichamberProject], HOME)).toBeNull();
  });
});

describe('resolveWelcomeWorkspaceLabel', () => {
  test('existing home session uses ~, not the raw folder name', () => {
    expect(resolveWelcomeWorkspaceLabel({
      projects,
      homeDirectory: HOME,
      sessionDirectory: HOME,
      draftProject: pichamberProject,
      preferSessionProject: true,
    })).toBe('~');
  });

  test('existing session in an opened project uses that project label', () => {
    expect(resolveWelcomeWorkspaceLabel({
      projects,
      homeDirectory: HOME,
      sessionDirectory: PICHAMBER,
      draftProject: homeProject,
      preferSessionProject: true,
    })).toBe('pichamber');
  });

  test('existing session without a matching project still formats home as ~', () => {
    expect(resolveWelcomeWorkspaceLabel({
      projects: [pichamberProject],
      homeDirectory: HOME,
      sessionDirectory: HOME,
      preferSessionProject: true,
    })).toBe('~');
  });

  test('new-session draft uses the selected draft project', () => {
    expect(resolveWelcomeWorkspaceLabel({
      projects,
      homeDirectory: HOME,
      sessionDirectory: HOME,
      draftProject: pichamberProject,
      preferSessionProject: false,
    })).toBe('pichamber');
  });

  test('new-session draft on home uses ~', () => {
    expect(resolveWelcomeWorkspaceLabel({
      projects,
      homeDirectory: HOME,
      draftProject: homeProject,
      preferSessionProject: false,
    })).toBe('~');
  });

  test('existing session without a directory falls back to the draft project label', () => {
    expect(resolveWelcomeWorkspaceLabel({
      projects,
      homeDirectory: HOME,
      sessionDirectory: null,
      draftProject: pichamberProject,
      preferSessionProject: true,
    })).toBe('pichamber');
  });
});
