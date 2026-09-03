import assert from 'node:assert/strict';
import test from 'node:test';

import {
  beginLinuxNativeDialogConstrain,
  boundsOverflowWorkArea,
  buildLinuxDialogConstrainChildEval,
  clampBoundsToWorkArea,
  isFileChooserTitle,
  parseXwininfoTree,
  runLinuxDialogConstrainPass,
  shouldConstrainLinuxDialogWindow,
} from './linux-native-dialog-bounds.mjs';

const WORK_AREA_800 = { x: 0, y: 0, width: 1280, height: 800 };
const GTK_SAVE_FILE_CLIPPED = { x: 395, y: 58, width: 1124, height: 822 };

test('clampBoundsToWorkArea keeps Cancel/Open on an 800px work area', () => {
  const next = clampBoundsToWorkArea({ x: 78, y: 58, width: 1124, height: 822 }, WORK_AREA_800);
  assert.equal(next.width, 1124);
  assert.ok(next.height <= WORK_AREA_800.height);
  assert.equal(next.height, 800);
  assert.ok(next.y >= WORK_AREA_800.y);
  assert.ok(next.y + next.height <= WORK_AREA_800.y + WORK_AREA_800.height);
  assert.ok(next.x >= WORK_AREA_800.x);
  assert.ok(next.x + next.width <= WORK_AREA_800.x + WORK_AREA_800.width);
  assert.equal(next.y, 0);
});

test('clampBoundsToWorkArea keeps Cancel/Save on a clipped GTK Save File dialog', () => {
  assert.equal(
    boundsOverflowWorkArea(GTK_SAVE_FILE_CLIPPED, WORK_AREA_800),
    true,
  );
  const next = clampBoundsToWorkArea(GTK_SAVE_FILE_CLIPPED, WORK_AREA_800);
  assert.deepEqual(next, { x: 156, y: 0, width: 1124, height: 800 });
  assert.ok(next.x + next.width <= WORK_AREA_800.x + WORK_AREA_800.width);
  assert.ok(next.y + next.height <= WORK_AREA_800.y + WORK_AREA_800.height);
});

test('clampBoundsToWorkArea fills a shorter docked work area', () => {
  const workArea = { x: 0, y: 0, width: 1280, height: 743 };
  const next = clampBoundsToWorkArea({ x: 78, y: 58, width: 1124, height: 822 }, workArea);
  assert.deepEqual(next, { x: 78, y: 0, width: 1124, height: 743 });
  assert.ok(next.height <= workArea.height);
});

test('boundsOverflowWorkArea detects the GTK 1124x822 chooser', () => {
  assert.equal(
    boundsOverflowWorkArea({ x: 78, y: 58, width: 1124, height: 822 }, WORK_AREA_800),
    true,
  );
  assert.equal(
    boundsOverflowWorkArea({ x: 78, y: 0, width: 1124, height: 800 }, WORK_AREA_800),
    false,
  );
});

test('parseXwininfoTree reads named client geometry', () => {
  const windows = parseXwininfoTree(`
  Root window id: 0x21f (the root window) (has no name)
     0x2a00004 "audit-fix PR#368 | Pichamber": ("pichamber" "pichamber")  1276x747+0+0  +0+0
     0x2b00001 "Attach files": ("pichamber" "pichamber")  1124x822+78+58  +78+58
     0x2a0000a (has no name): ()  1x1+0+0  +0+0
`);
  assert.equal(windows.length, 2);
  assert.deepEqual(windows[0], {
    xid: 0x2a00004,
    name: 'audit-fix PR#368 | Pichamber',
    instance: 'pichamber',
    className: 'pichamber',
    width: 1276,
    height: 747,
    x: 0,
    y: 0,
  });
  assert.equal(windows[1].name, 'Attach files');
  assert.equal(windows[1].height, 822);
  assert.equal(windows[1].y, 58);
});

test('runLinuxDialogConstrainPass resizes the chooser and skips the parent', async () => {
  const resized = [];
  const ignore = new Set([0x2a00004]);
  const result = await runLinuxDialogConstrainPass({
    workArea: WORK_AREA_800,
    ignoreXids: ignore,
    windows: [
      { xid: 0x2a00004, name: 'audit-fix PR#368 | Pichamber', x: 0, y: 0, width: 1276, height: 747 },
      { xid: 0x2b00001, name: 'Attach files', x: 78, y: 58, width: 1124, height: 822 },
    ],
    resizeWindow: async (xid, bounds) => { resized.push({ xid, bounds }); },
  });
  assert.equal(resized.length, 1);
  assert.equal(resized[0].xid, 0x2b00001);
  assert.ok(resized[0].bounds.height <= 800);
  assert.ok(resized[0].bounds.y + resized[0].bounds.height <= 800);
  assert.deepEqual(result[0].bounds, resized[0].bounds);
  assert.equal(
    shouldConstrainLinuxDialogWindow(
      { xid: 0x2a00004, name: 'audit-fix PR#368 | Pichamber', x: 0, y: 0, width: 1276, height: 747 },
      WORK_AREA_800,
      ignore,
    ),
    false,
  );
});

test('runLinuxDialogConstrainPass resizes a Save File dialog clipped on 1280x800', async () => {
  const resized = [];
  const ignore = new Set([0x2a00004]);
  const saveWin = { xid: 0x2b00002, name: 'Save File', ...GTK_SAVE_FILE_CLIPPED };
  assert.equal(isFileChooserTitle(saveWin.name), true);
  assert.equal(shouldConstrainLinuxDialogWindow(saveWin, WORK_AREA_800, ignore), true);
  const result = await runLinuxDialogConstrainPass({
    workArea: WORK_AREA_800,
    ignoreXids: ignore,
    windows: [
      { xid: 0x2a00004, name: 'audit-fix PR#368 | Pichamber', x: 0, y: 0, width: 1276, height: 747 },
      saveWin,
    ],
    resizeWindow: async (xid, bounds) => { resized.push({ xid, bounds }); },
  });
  assert.equal(resized.length, 1);
  assert.equal(resized[0].xid, 0x2b00002);
  assert.deepEqual(resized[0].bounds, { x: 156, y: 0, width: 1124, height: 800 });
  assert.deepEqual(result[0].bounds, resized[0].bounds);
});

test('beginLinuxNativeDialogConstrain is a no-op off Linux', async () => {
  const started = await beginLinuxNativeDialogConstrain({
    platform: 'darwin',
    electronScreen: { getPrimaryDisplay: () => ({ workArea: WORK_AREA_800 }) },
  });
  assert.equal(started.workArea, null);
  started.stop();
});

test('child constrain script clamps height against workArea', () => {
  const source = buildLinuxDialogConstrainChildEval();
  assert.match(source, /xwininfo/);
  assert.match(source, /xdotool/);
  assert.match(source, /Math.min\(Math.max\(1, Math.round\(b.height\)\), a.height\)/);
  assert.match(source, /PICHAMBER_DIALOG_CONSTRAIN/);
  assert.match(source, /attach files\|select file\|open\|save/);
});
