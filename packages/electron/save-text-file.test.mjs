import assert from 'node:assert/strict';
import fs from 'node:fs';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { normalizeSaveDialogFilters, resolveSaveDialogWritePath } from './save-text-file.mjs';

describe('normalizeSaveDialogFilters', () => {
  it('keeps named filters with non-empty extensions', () => {
    assert.deepEqual(
      normalizeSaveDialogFilters([
        { name: 'JSONL', extensions: ['jsonl'] },
        { name: 'HTML', extensions: ['html', ''] },
      ]),
      [
        { name: 'JSONL', extensions: ['jsonl'] },
        { name: 'HTML', extensions: ['html'] },
      ],
    );
  });

  it('drops empty or invalid filters', () => {
    assert.deepEqual(normalizeSaveDialogFilters(undefined), []);
    assert.deepEqual(normalizeSaveDialogFilters([
      null,
      { name: '', extensions: [] },
      { name: 'JSONL' },
      { extensions: ['jsonl'] },
    ]), [
      { name: 'Files', extensions: ['jsonl'] },
    ]);
  });
});

describe('resolveSaveDialogWritePath', () => {
  it('returns null when the user cancels', () => {
    assert.equal(resolveSaveDialogWritePath({ canceled: true, filePath: '/tmp/session.jsonl' }), null);
  });

  it('returns the path only after a real save choice', () => {
    assert.equal(resolveSaveDialogWritePath({ canceled: false, filePath: '/tmp/session.jsonl' }), '/tmp/session.jsonl');
    assert.equal(resolveSaveDialogWritePath({ canceled: false, filePath: '  ' }), null);
  });
});

describe('desktop_save_text_file IPC', () => {
  it('shares the markdown save dialog and writes only after a path is chosen', () => {
    const source = fs.readFileSync(fileURLToPath(new URL('./main.mjs', import.meta.url)), 'utf8');
    assert.match(source, /case 'desktop_save_text_file':/);
    assert.match(source, /normalizeSaveDialogFilters\(args\.filters\)/);
    assert.match(source, /resolveSaveDialogWritePath\(result\)/);
    assert.match(source, /const showConstrainedSaveDialog = async \(browserWindow, options\) =>/);
    assert.match(source, /beginLinuxNativeDialogConstrain/);
    const helper = source.slice(source.indexOf('const showConstrainedSaveDialog'));
    const helperBody = helper.slice(0, helper.indexOf('const handleInvoke'));
    assert.match(helperBody, /dialog\.showSaveDialog/);
    assert.match(helperBody, /linuxDialogConstrain\.stop\(\)/);
    const handler = source.slice(source.indexOf("case 'desktop_save_markdown_file'"));
    const body = handler.slice(0, handler.indexOf("case 'desktop_save_image'"));
    assert.match(body, /showConstrainedSaveDialog\(/);
    assert.match(body, /if \(!filePath\) \{\s*return null;/s);
    assert.match(body, /await fsp\.writeFile\(filePath, content, 'utf8'\)/);
    const imageHandler = source.slice(source.indexOf("case 'desktop_save_image'"));
    const imageBody = imageHandler.slice(0, imageHandler.indexOf("case 'desktop_read_file'"));
    assert.match(imageBody, /showConstrainedSaveDialog\(/);
  });
});
