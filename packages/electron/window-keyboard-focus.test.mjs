import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

test('native dialogs and desktop_focus_window restore renderer keyboard focus', () => {
  const source = fs.readFileSync(fileURLToPath(new URL('./main.mjs', import.meta.url)), 'utf8');
  assert.match(source, /const restoreRendererKeyboardFocus = \(browserWindow\) =>/);
  assert.match(source, /target\.webContents\?\.focus\(\)/);
  assert.match(source, /case 'desktop_focus_window': \{\s*return restoreRendererKeyboardFocus\(browserWindow\);/s);
  assert.match(source, /result = await dialog\.showOpenDialog/);
  const dialogHandler = source.slice(source.indexOf("ipcMain.handle('openchamber:dialog:open'"));
  const handlerBody = dialogHandler.slice(0, dialogHandler.indexOf("ipcMain.handle('openchamber:file:grant-existing'"));
  assert.match(handlerBody, /try \{/);
  assert.match(handlerBody, /finally \{\s*restoreRendererKeyboardFocus\(browserWindow\);/s);
});
