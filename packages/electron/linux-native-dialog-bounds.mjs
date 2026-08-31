import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const FILE_CHOOSER_TITLE = /^(attach files|select file|select working directory|open|open file|open folder|open files|choose file|choose files|select folder|select directory)$/i;
const FILE_CHOOSER_CLASS = /filechooser|xdg-desktop-portal/i;
const APP_MAIN_TITLE = /pichamber|openchamber/i;
const NAMED_WINDOW = /^\s*(0x[0-9a-fA-F]+)\s+"([^"]*)":\s+\("([^"]*)"\s+"([^"]*)"\)\s+(\d+)x(\d+)\+(-?\d+)\+(-?\d+)\s+\+(-?\d+)\+(-?\d+)/;

const PYTHON_RESIZE = [
  'import ctypes, sys',
  'xid = int(sys.argv[1], 0)',
  'x, y, w, h = map(int, sys.argv[2:6])',
  'x11 = ctypes.cdll.LoadLibrary("libX11.so.6")',
  'x11.XOpenDisplay.restype = ctypes.c_void_p',
  'dpy = x11.XOpenDisplay(None)',
  'if not dpy:',
  '    raise SystemExit(2)',
  'x11.XMoveResizeWindow(ctypes.c_void_p(dpy), ctypes.c_ulong(xid), x, y, w, h)',
  'x11.XFlush(ctypes.c_void_p(dpy))',
  'x11.XCloseDisplay(ctypes.c_void_p(dpy))',
].join('\n');

export const clampBoundsToWorkArea = (bounds, workArea) => {
  const areaWidth = Math.max(1, Math.round(Number(workArea?.width) || 0));
  const areaHeight = Math.max(1, Math.round(Number(workArea?.height) || 0));
  const areaX = Number.isFinite(Number(workArea?.x)) ? Math.round(Number(workArea.x)) : 0;
  const areaY = Number.isFinite(Number(workArea?.y)) ? Math.round(Number(workArea.y)) : 0;
  const width = Math.min(Math.max(1, Math.round(Number(bounds?.width) || 0)), areaWidth);
  const height = Math.min(Math.max(1, Math.round(Number(bounds?.height) || 0)), areaHeight);
  const maxX = areaX + areaWidth - width;
  const maxY = areaY + areaHeight - height;
  const rawX = Math.round(Number(bounds?.x));
  const rawY = Math.round(Number(bounds?.y));
  return {
    x: Number.isFinite(rawX) ? Math.min(Math.max(rawX, areaX), maxX) : areaX,
    y: Number.isFinite(rawY) ? Math.min(Math.max(rawY, areaY), maxY) : areaY,
    width,
    height,
  };
};

export const boundsOverflowWorkArea = (bounds, workArea) => {
  if (!workArea) return false;
  const x = Number(bounds?.x);
  const y = Number(bounds?.y);
  const width = Number(bounds?.width);
  const height = Number(bounds?.height);
  if (![x, y, width, height, workArea.x, workArea.y, workArea.width, workArea.height].every(Number.isFinite)) {
    return false;
  }
  return width > workArea.width
    || height > workArea.height
    || x < workArea.x
    || y < workArea.y
    || (x + width) > (workArea.x + workArea.width)
    || (y + height) > (workArea.y + workArea.height);
};

export const normalizeXid = (value) => {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value >>> 0;
  }
  if (typeof value === 'string' && value.trim()) {
    const text = value.trim();
    const n = Number.parseInt(text, /^0x/i.test(text) ? 16 : 10);
    return Number.isFinite(n) && n > 0 ? n >>> 0 : null;
  }
  if (Buffer.isBuffer(value)) {
    if (value.length >= 4) {
      const n = value.readUInt32LE(0);
      return n > 0 ? n >>> 0 : null;
    }
  }
  return null;
};

export const parseXwininfoTree = (output) => {
  const windows = [];
  for (const line of String(output || '').split('\n')) {
    const match = NAMED_WINDOW.exec(line);
    if (!match) continue;
    const xid = normalizeXid(match[1]);
    if (xid == null) continue;
    windows.push({
      xid,
      name: match[2],
      instance: match[3] || '',
      className: match[4] || '',
      width: Number(match[5]),
      height: Number(match[6]),
      x: Number(match[9]),
      y: Number(match[10]),
    });
  }
  return windows;
};

export const isFileChooserTitle = (name) => FILE_CHOOSER_TITLE.test(String(name || '').trim());

export const isAppMainWindowTitle = (name) => {
  const text = String(name || '');
  return APP_MAIN_TITLE.test(text) && !isFileChooserTitle(text);
};

export const shouldConstrainLinuxDialogWindow = (win, workArea, ignoreXids = new Set()) => {
  const xid = normalizeXid(win?.xid);
  if (xid == null) return false;
  if (ignoreXids.has(xid)) return false;
  if (isAppMainWindowTitle(win?.name)) return false;
  const width = Number(win?.width) || 0;
  const height = Number(win?.height) || 0;
  if (width < 240 || height < 160) return false;
  if (!boundsOverflowWorkArea(win, workArea)) return false;
  if (isFileChooserTitle(win?.name)) return true;
  if (FILE_CHOOSER_CLASS.test(`${win?.instance || ''} ${win?.className || ''}`)) return true;
  return true;
};

export const sameBounds = (left, right) => (
  left.x === right.x
  && left.y === right.y
  && left.width === right.width
  && left.height === right.height
);

export const runLinuxDialogConstrainPass = async ({
  windows,
  workArea,
  ignoreXids,
  resizeWindow,
} = {}) => {
  const ignore = new Set([...ignoreXids || []].map(normalizeXid).filter((id) => id != null));
  const resized = [];
  for (const win of windows || []) {
    if (!shouldConstrainLinuxDialogWindow(win, workArea, ignore)) continue;
    const next = clampBoundsToWorkArea(win, workArea);
    if (sameBounds({ x: win.x, y: win.y, width: win.width, height: win.height }, next)) continue;
    if (typeof resizeWindow === 'function') {
      await resizeWindow(win.xid, next);
    }
    resized.push({ xid: normalizeXid(win.xid), bounds: next });
  }
  return resized;
};

export const listLinuxX11Windows = async ({ execFileFn = execFileAsync, env = process.env } = {}) => {
  const { stdout } = await execFileFn('xwininfo', ['-root', '-tree'], {
    env,
    encoding: 'utf8',
    timeout: 3000,
    maxBuffer: 2 * 1024 * 1024,
  });
  return parseXwininfoTree(stdout);
};

export const resizeLinuxX11Window = async (xid, bounds, { execFileFn = execFileAsync, env = process.env } = {}) => {
  const id = String(normalizeXid(xid));
  try {
    await execFileFn('xdotool', [
      'windowmove', '--sync', id, String(bounds.x), String(bounds.y),
      'windowsize', '--sync', id, String(bounds.width), String(bounds.height),
    ], { env, timeout: 3000, encoding: 'utf8' });
    return 'xdotool';
  } catch {
    await execFileFn('python3', [
      '-c', PYTHON_RESIZE, id,
      String(bounds.x), String(bounds.y), String(bounds.width), String(bounds.height),
    ], { env, timeout: 3000, encoding: 'utf8' });
    return 'x11';
  }
};

export const resolveDisplayWorkArea = (browserWindow, electronScreen) => {
  try {
    const bounds = browserWindow && !browserWindow.isDestroyed?.()
      ? browserWindow.getBounds()
      : null;
    const display = bounds
      ? electronScreen.getDisplayMatching(bounds)
      : electronScreen.getPrimaryDisplay();
    const workArea = display?.workArea;
    if (workArea && workArea.width > 0 && workArea.height > 0) {
      return {
        x: Number(workArea.x) || 0,
        y: Number(workArea.y) || 0,
        width: Number(workArea.width),
        height: Number(workArea.height),
      };
    }
  } catch {
    // Keep the native dialog path working if screen lookup fails.
  }
  return null;
};

export const buildLinuxDialogConstrainChildEval = () => `
const { execFile } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);
const cfg = JSON.parse(process.env.PICHAMBER_DIALOG_CONSTRAIN || '{}');
const workArea = cfg.workArea;
const ignore = new Set((cfg.ignoreXids || []).map((id) => Number(id)).filter((id) => id > 0));
const timeoutMs = Math.max(1000, Number(cfg.timeoutMs) || 12000);
const intervalMs = Math.max(30, Number(cfg.intervalMs) || 50);
const named = /^\\s*(0x[0-9a-fA-F]+)\\s+"([^"]*)":\\s+\\("([^"]*)"\\s+"([^"]*)"\\)\\s+(\\d+)x(\\d+)\\+(-?\\d+)\\+(-?\\d+)\\s+\\+(-?\\d+)\\+(-?\\d+)/;
const clamp = (b, a) => {
  const width = Math.min(Math.max(1, Math.round(b.width)), a.width);
  const height = Math.min(Math.max(1, Math.round(b.height)), a.height);
  const maxX = a.x + a.width - width;
  const maxY = a.y + a.height - height;
  return {
    x: Math.min(Math.max(Math.round(b.x), a.x), maxX),
    y: Math.min(Math.max(Math.round(b.y), a.y), maxY),
    width,
    height,
  };
};
const list = async () => {
  const { stdout } = await execFileAsync('xwininfo', ['-root', '-tree'], {
    encoding: 'utf8', timeout: 3000, env: process.env, maxBuffer: 2 * 1024 * 1024,
  });
  const windows = [];
  for (const line of String(stdout).split('\\n')) {
    const m = named.exec(line);
    if (!m) continue;
    windows.push({ xid: parseInt(m[1], 16), name: m[2], x: +m[9], y: +m[10], width: +m[5], height: +m[6] });
  }
  return windows;
};
const resize = async (xid, b) => {
  const id = String(xid);
  try {
    await execFileAsync('xdotool', [
      'windowmove', '--sync', id, String(b.x), String(b.y),
      'windowsize', '--sync', id, String(b.width), String(b.height),
    ], { timeout: 3000, env: process.env });
  } catch {
    const py = [
      'import ctypes,sys',
      'xid=int(sys.argv[1],0);x,y,w,h=map(int,sys.argv[2:6])',
      'X=ctypes.cdll.LoadLibrary("libX11.so.6")',
      'X.XOpenDisplay.restype=ctypes.c_void_p',
      'd=X.XOpenDisplay(None)',
      'X.XMoveResizeWindow(ctypes.c_void_p(d),ctypes.c_ulong(xid),x,y,w,h)',
      'X.XFlush(ctypes.c_void_p(d))',
      'X.XCloseDisplay(ctypes.c_void_p(d))',
    ].join('\\n');
    await execFileAsync('python3', ['-c', py, id, String(b.x), String(b.y), String(b.width), String(b.height)], {
      timeout: 3000, env: process.env,
    });
  }
};
const pass = async () => {
  if (!workArea) return;
  for (const win of await list()) {
    if (!win.xid || ignore.has(win.xid)) continue;
    if (/pichamber|openchamber/i.test(win.name || '') && !/^(attach files|select file|open)/i.test((win.name || '').trim())) continue;
    if (win.width < 240 || win.height < 160) continue;
    const overflows = win.width > workArea.width || win.height > workArea.height
      || win.x < workArea.x || win.y < workArea.y
      || win.x + win.width > workArea.x + workArea.width
      || win.y + win.height > workArea.y + workArea.height;
    if (!overflows) continue;
    const next = clamp(win, workArea);
    if (next.x === win.x && next.y === win.y && next.width === win.width && next.height === win.height) continue;
    await resize(win.xid, next);
  }
};
(async () => {
  const started = Date.now();
  await pass();
  while (Date.now() - started < timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
    await pass();
  }
})().catch(() => {});
`;

export const beginLinuxNativeDialogConstrain = async ({
  platform = process.platform,
  browserWindow,
  electronScreen,
  execPath = process.execPath,
  env = process.env,
  spawnFn = spawn,
  execFileFn = execFileAsync,
  timeoutMs = 12000,
} = {}) => {
  const stopFns = [];
  const stop = () => {
    while (stopFns.length) {
      try { stopFns.pop()(); } catch { /* ignore */ }
    }
  };
  if (platform !== 'linux') return { stop, workArea: null, ignoreXids: [] };

  const workArea = resolveDisplayWorkArea(browserWindow, electronScreen);
  if (!workArea) return { stop, workArea: null, ignoreXids: [] };

  const ignoreXids = [];
  try {
    const parentXid = normalizeXid(browserWindow?.getNativeWindowHandle?.());
    if (parentXid) ignoreXids.push(parentXid);
  } catch { /* native handle is best-effort */ }
  try {
    const existing = await listLinuxX11Windows({ execFileFn, env });
    for (const win of existing) {
      if (win.xid) ignoreXids.push(win.xid);
    }
  } catch { /* snapshot is best-effort; title heuristics still apply */ }

  let alive = true;
  const tick = async () => {
    if (!alive) return;
    try {
      const windows = await listLinuxX11Windows({ execFileFn, env });
      await runLinuxDialogConstrainPass({
        windows,
        workArea,
        ignoreXids,
        resizeWindow: (xid, bounds) => resizeLinuxX11Window(xid, bounds, { execFileFn, env }),
      });
    } catch { /* keep polling */ }
  };
  const interval = setInterval(() => { void tick(); }, 50);
  stopFns.push(() => {
    alive = false;
    clearInterval(interval);
  });
  void tick();

  try {
    const child = spawnFn(execPath, ['-e', buildLinuxDialogConstrainChildEval()], {
      env: {
        ...env,
        ELECTRON_RUN_AS_NODE: '1',
        PICHAMBER_DIALOG_CONSTRAIN: JSON.stringify({
          workArea,
          ignoreXids: [...new Set(ignoreXids.map(normalizeXid).filter((id) => id != null))],
          timeoutMs,
          intervalMs: 50,
        }),
      },
      stdio: 'ignore',
      detached: false,
    });
    stopFns.push(() => {
      try { child.kill('SIGTERM'); } catch { /* already gone */ }
    });
  } catch { /* in-process poller still runs */ }

  return { stop, workArea, ignoreXids };
};
