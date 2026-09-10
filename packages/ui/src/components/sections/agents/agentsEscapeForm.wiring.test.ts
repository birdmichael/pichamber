import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'bun:test';

const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'AgentsPage.tsx'), 'utf8');

test('Create-agent draft takes Settings Esc before the window closes (#631)', () => {
  expect(source).toContain("import { SETTINGS_ESCAPE_FORM_EVENT } from '@/lib/settings-dismiss'");
  expect(source).toContain("data-settings-escape-form={isNewAgent ? 'true' : undefined}");
  expect(source).toContain('SETTINGS_ESCAPE_FORM_EVENT');
  expect(source).toContain('abandonNewDraft');
  expect(source.indexOf('abandonNewDraft')).toBeLessThan(source.indexOf("data-settings-escape-form={isNewAgent"));
});
