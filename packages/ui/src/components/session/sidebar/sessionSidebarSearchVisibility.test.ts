import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const sessionSidebarSource = readFileSync(join(here, '../SessionSidebar.tsx'), 'utf8');
const projectsListSource = readFileSync(join(here, 'SidebarProjectsList.tsx'), 'utf8');

describe('sidebar search keeps chats/recent visible', () => {
  test('SessionSidebar does not hide activity solely because a search query is present', () => {
    expect(sessionSidebarSource).toContain('shouldShowSidebarActivitySections');
    expect(sessionSidebarSource).toContain('countSidebarSearchMatches');
    expect(sessionSidebarSource).toContain('showActivitySections ? (');
    expect(sessionSidebarSource).not.toMatch(/!isVSCode && !hasSessionSearchQuery && hasActivitySectionItems/);
  });

  test('an empty project-search list still renders topContent so chats hits remain', () => {
    expect(projectsListSource).toContain('sectionsForRender.length === 0');
    const emptyProjectSearchBranch = projectsListSource.slice(
      projectsListSource.indexOf('if (props.sectionsForRender.length === 0)'),
      projectsListSource.indexOf('if (props.sectionsForRender.length === 0)') + 700,
    );
    expect(emptyProjectSearchBranch).toContain('{props.topContent}');
    expect(emptyProjectSearchBranch).toContain('{props.topContent ? null : props.searchEmptyState}');
  });
});
