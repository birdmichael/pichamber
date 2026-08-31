import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const settingsWindowSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'SettingsWindow.tsx'),
  'utf8',
);

const dialogSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../ui/dialog.tsx'),
  'utf8',
);

describe('dialog leftover overlay', () => {
  test('closing Settings disables pointer events on the leftover backdrop and popup', () => {
    expect(settingsWindowSource).toContain("!open && 'pointer-events-none'");
    expect(settingsWindowSource).toContain('data-[ending-style]:pointer-events-none');
  });

  test('open Settings counts as a dialog layer so nested closes cannot uncover the sidebar', () => {
    expect(settingsWindowSource).toContain('markDialogLayerMounted');
    expect(settingsWindowSource).toContain('if (!open)');
  });

  test('shared dialog popups drop pointer events while they are exiting', () => {
    expect(dialogSource).toContain('data-[ending-style]:pointer-events-none');
    expect(dialogSource).toContain('data-slot="dialog-content"');
  });

  test('shared dialog overlays keep pointer events on nested exit', () => {
    expect(dialogSource).toContain('useDialogLayerRegistration');
    expect(dialogSource).toContain('dropPointerEventsOnExit && "data-[ending-style]:pointer-events-none"');
  });

  test('blocked dismiss calls cancel so Base UI does not leave an ending overlay', () => {
    expect(settingsWindowSource).toContain('shouldBlockSettingsDismiss');
    expect(settingsWindowSource).toContain('eventDetails?.cancel?.()');
  });
});
