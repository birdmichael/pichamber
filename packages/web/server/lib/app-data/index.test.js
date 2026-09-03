import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  defaultAppDataDir,
  isManagedChatsPath,
  legacyAppDataDir,
  resetAppDataDirCacheForTests,
  resolveAppDataDir,
  resolveOverrideDataDir,
} from './index.js';

const previousBranded = process.env.PICHAMBER_DATA_DIR;
const previousAlias = process.env.OPENCHAMBER_DATA_DIR;

const makeHome = () => fs.mkdtempSync(path.join(os.tmpdir(), 'pichamber-app-data-'));

const writeFile = (filePath, contents) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents);
};

const read = (filePath) => fs.readFileSync(filePath, 'utf8');

const exists = (target) => {
  try {
    fs.lstatSync(target);
    return true;
  } catch {
    return false;
  }
};

const bindFs = (overrides = {}) => ({
  lstatSync: fs.lstatSync.bind(fs),
  readdirSync: fs.readdirSync.bind(fs),
  readlinkSync: fs.readlinkSync.bind(fs),
  cpSync: fs.cpSync.bind(fs),
  renameSync: fs.renameSync.bind(fs),
  rmSync: fs.rmSync.bind(fs),
  mkdirSync: fs.mkdirSync.bind(fs),
  ...overrides,
});

describe('app data directory', () => {
  beforeEach(() => {
    resetAppDataDirCacheForTests();
    delete process.env.PICHAMBER_DATA_DIR;
    delete process.env.OPENCHAMBER_DATA_DIR;
  });

  afterEach(() => {
    resetAppDataDirCacheForTests();
    if (previousBranded === undefined) delete process.env.PICHAMBER_DATA_DIR;
    else process.env.PICHAMBER_DATA_DIR = previousBranded;
    if (previousAlias === undefined) delete process.env.OPENCHAMBER_DATA_DIR;
    else process.env.OPENCHAMBER_DATA_DIR = previousAlias;
  });

  it('defaults to ~/.config/pichamber', () => {
    const home = makeHome();
    expect(resolveAppDataDir({ home, env: {}, migrate: false })).toBe(path.join(home, '.config', 'pichamber'));
    expect(defaultAppDataDir(home)).toBe(path.join(home, '.config', 'pichamber'));
    expect(legacyAppDataDir(home)).toBe(path.join(home, '.config', 'openchamber'));
  });

  it('prefers PICHAMBER_DATA_DIR over the deprecated OPENCHAMBER_DATA_DIR alias', () => {
    const home = makeHome();
    const branded = path.join(home, 'branded');
    const alias = path.join(home, 'alias');
    expect(resolveOverrideDataDir({
      PICHAMBER_DATA_DIR: branded,
      OPENCHAMBER_DATA_DIR: alias,
    })).toBe(path.resolve(branded));
    expect(resolveAppDataDir({
      home,
      env: {
        PICHAMBER_DATA_DIR: branded,
        OPENCHAMBER_DATA_DIR: alias,
      },
    })).toBe(path.resolve(branded));
  });

  it('uses OPENCHAMBER_DATA_DIR as a deprecated alias', () => {
    const home = makeHome();
    const alias = path.join(home, 'legacy-override');
    expect(resolveAppDataDir({
      home,
      env: { OPENCHAMBER_DATA_DIR: ` ${alias} ` },
    })).toBe(path.resolve(alias));
  });

  it('treats whitespace-only env values as unset', () => {
    const home = makeHome();
    expect(resolveAppDataDir({
      home,
      env: { PICHAMBER_DATA_DIR: '   ', OPENCHAMBER_DATA_DIR: '\t' },
      migrate: false,
    })).toBe(defaultAppDataDir(home));
  });

  it('copies leftover ~/.config/openchamber onto a missing branded dir', () => {
    const home = makeHome();
    const source = legacyAppDataDir(home);
    const dest = defaultAppDataDir(home);
    writeFile(path.join(source, 'settings.json'), '{"theme":"dark"}');
    writeFile(path.join(source, 'quota', 'cursor.json'), '{"accessToken":"secret"}');
    writeFile(path.join(source, 'chats', '2026-08-21', 'session-a', '.keep'), '');
    writeFile(path.join(home, '.pi', 'agent', 'auth.json'), '{"keep":true}');

    expect(resolveAppDataDir({ home, env: {} })).toBe(dest);
    expect(read(path.join(dest, 'settings.json'))).toBe('{"theme":"dark"}');
    expect(read(path.join(dest, 'quota', 'cursor.json'))).toBe('{"accessToken":"secret"}');
    expect(exists(path.join(dest, 'chats', '2026-08-21', 'session-a', '.keep'))).toBe(true);
    expect(read(path.join(source, 'settings.json'))).toBe('{"theme":"dark"}');
    expect(read(path.join(home, '.pi', 'agent', 'auth.json'))).toBe('{"keep":true}');
    expect(exists(path.join(dest, '.pi'))).toBe(false);
  });

  it('migrates into an empty branded dir and not a dest that already has files', () => {
    const home = makeHome();
    const source = legacyAppDataDir(home);
    const dest = defaultAppDataDir(home);
    writeFile(path.join(source, 'settings.json'), '{"from":"openchamber"}');
    fs.mkdirSync(dest, { recursive: true });
    expect(resolveAppDataDir({ home, env: {} })).toBe(dest);
    expect(read(path.join(dest, 'settings.json'))).toBe('{"from":"openchamber"}');

    resetAppDataDirCacheForTests();
    const occupied = makeHome();
    writeFile(path.join(legacyAppDataDir(occupied), 'settings.json'), '{"from":"openchamber"}');
    writeFile(path.join(defaultAppDataDir(occupied), 'settings.json'), '{"from":"pichamber"}');
    expect(resolveAppDataDir({ home: occupied, env: {} })).toBe(defaultAppDataDir(occupied));
    expect(read(path.join(defaultAppDataDir(occupied), 'settings.json'))).toBe('{"from":"pichamber"}');
    expect(read(path.join(legacyAppDataDir(occupied), 'settings.json'))).toBe('{"from":"openchamber"}');
  });

  it('does not migrate when an override env is set', () => {
    const home = makeHome();
    writeFile(path.join(legacyAppDataDir(home), 'settings.json'), '{"from":"openchamber"}');
    const override = path.join(home, 'custom');
    expect(resolveAppDataDir({ home, env: { PICHAMBER_DATA_DIR: override } })).toBe(path.resolve(override));
    expect(exists(defaultAppDataDir(home))).toBe(false);
  });

  it('leaves source in place when copy verification fails and rolls dest back', () => {
    const home = makeHome();
    const source = legacyAppDataDir(home);
    const dest = defaultAppDataDir(home);
    writeFile(path.join(source, 'settings.json'), '{"keep":true}');
    const fsImpl = bindFs({
      cpSync: (from, to) => {
        fs.mkdirSync(to, { recursive: true });
        fs.writeFileSync(path.join(to, 'settings.json'), '{"partial":true}');
      },
    });

    expect(resolveAppDataDir({ home, env: {}, fs: fsImpl })).toBe(dest);
    expect(read(path.join(source, 'settings.json'))).toBe('{"keep":true}');
    expect(exists(dest)).toBe(false);
    expect(fs.readdirSync(path.join(home, '.config')).some((name) => name.includes('migrating'))).toBe(false);
  });

  it('does not destroy source when copy throws, and restores an empty dest', () => {
    const home = makeHome();
    const source = legacyAppDataDir(home);
    const dest = defaultAppDataDir(home);
    writeFile(path.join(source, 'settings.json'), '{"keep":true}');
    fs.mkdirSync(dest, { recursive: true });
    const fsImpl = bindFs({
      cpSync: () => {
        throw new Error('disk full');
      },
    });

    expect(resolveAppDataDir({ home, env: {}, fs: fsImpl })).toBe(dest);
    expect(read(path.join(source, 'settings.json'))).toBe('{"keep":true}');
    expect(fs.readdirSync(dest)).toEqual([]);
  });

  it('dual-reads leftover and branded managed chat paths', () => {
    expect(isManagedChatsPath('/home/box/.config/pichamber/chats/2026-08-21/session-a')).toBe(true);
    expect(isManagedChatsPath('/home/box/.config/openchamber/chats/2026-08-21/session-a')).toBe(true);
    expect(isManagedChatsPath('/home/box/project')).toBe(false);
  });
});
