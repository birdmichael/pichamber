import { describe, expect, test } from 'bun:test';
import { mergePiToolsChecklist, PI_BASE_TOOLS } from './piAgentTools';

describe('mergePiToolsChecklist', () => {
  test('keeps the base grid when the agent has no extras', () => {
    expect(mergePiToolsChecklist([])).toEqual([...PI_BASE_TOOLS]);
    expect(mergePiToolsChecklist(['read', 'write', 'bash'])).toEqual([...PI_BASE_TOOLS]);
  });

  test('appends researcher web tools that are missing from the base grid', () => {
    expect(mergePiToolsChecklist([
      'read',
      'write',
      'web_search',
      'fetch_content',
      'get_search_content',
    ])).toEqual([
      ...PI_BASE_TOOLS,
      'web_search',
      'fetch_content',
      'get_search_content',
    ]);
  });

  test('appends contact_supervisor used by edit/worker', () => {
    expect(mergePiToolsChecklist([
      'read',
      'grep',
      'find',
      'ls',
      'bash',
      'edit',
      'write',
      'contact_supervisor',
    ])).toContain('contact_supervisor');
    expect(mergePiToolsChecklist(['contact_supervisor']).at(-1)).toBe('contact_supervisor');
  });

  test('ignores blanks and dedupes', () => {
    expect(mergePiToolsChecklist(['', ' web_search ', 'web_search', 'read'])).toEqual([
      ...PI_BASE_TOOLS,
      'web_search',
    ]);
  });
});
