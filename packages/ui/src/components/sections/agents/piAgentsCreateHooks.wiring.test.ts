import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'bun:test';

const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'PiAgentsPage.tsx'), 'utf8');

test('PiAgentsPage keeps toolsChecklist useMemo above Create-agent early returns (#672)', () => {
  const toolsChecklistMemo = source.indexOf('const toolsChecklist = React.useMemo');
  const pluginEarlyReturn = source.indexOf('if (!active) return <SettingsPageLayout');
  const explainerEarlyReturn = source.indexOf('if (!isCreating && !selectedName) return');

  expect(toolsChecklistMemo).toBeGreaterThan(-1);
  expect(pluginEarlyReturn).toBeGreaterThan(-1);
  expect(explainerEarlyReturn).toBeGreaterThan(-1);
  expect(toolsChecklistMemo).toBeLessThan(pluginEarlyReturn);
  expect(toolsChecklistMemo).toBeLessThan(explainerEarlyReturn);
  expect(source.split('const toolsChecklist = React.useMemo').length - 1).toBe(1);
});
