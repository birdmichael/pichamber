import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  createAdapterMcpConfig,
  deleteAdapterMcpConfig,
  getAdapterMcpConfig,
  isMcpFeaturePluginActive,
  listAdapterMcpConfigs,
  setAdapterMcpEnabled,
  statusMapFromAdapterConfigs,
  updateAdapterMcpConfig,
} from './mcp-config.js';
import { writeFeaturePlugins } from './feature-plugins.js';

const tempHomes = [];
afterEach(() => {
  for (const dir of tempHomes.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

const makeTemp = (prefix = 'pi-mcp-config-') => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempHomes.push(dir);
  return dir;
};

const writeJson = (filePath, value) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
};

describe('MCP feature plugin gate', () => {
  it('does not treat leftover adapter files as an active slot', () => {
    const home = makeTemp();
    const cwd = path.join(home, 'project');
    writeJson(path.join(home, '.config', 'mcp', 'mcp.json'), {
      mcpServers: { leftover: { command: 'npx', args: ['-y', 'demo'] } },
    });
    writeJson(path.join(cwd, '.mcp.json'), {
      mcpServers: { project: { command: 'uvx', args: ['demo'] } },
    });
    expect(isMcpFeaturePluginActive(home)).toBe(false);
    expect(listAdapterMcpConfigs({ home, cwd }).map((item) => item.name)).toEqual(['leftover', 'project']);
  });

  it('requires both installed and enabled', () => {
    const home = makeTemp();
    writeFeaturePlugins(home, { mcp: { enabled: true } });
    expect(isMcpFeaturePluginActive(home)).toBe(false);
    writeJson(path.join(home, '.pi', 'agent', 'settings.json'), {
      packages: ['npm:pi-mcp-adapter'],
    });
    expect(isMcpFeaturePluginActive(home)).toBe(true);
    writeFeaturePlugins(home, { mcp: { enabled: false } });
    expect(isMcpFeaturePluginActive(home)).toBe(false);
  });
});

describe('adapter MCP file write rules', () => {
  it('creates user servers in ~/.config/mcp/mcp.json and never .opencode/opencode.json', () => {
    const home = makeTemp();
    const cwd = path.join(home, 'project');
    fs.mkdirSync(cwd, { recursive: true });
    createAdapterMcpConfig({
      home,
      cwd,
      name: 'docs',
      scope: 'user',
      config: { type: 'local', command: ['npx', '-y', 'docs-mcp'] },
    });
    const userFile = JSON.parse(fs.readFileSync(path.join(home, '.config', 'mcp', 'mcp.json'), 'utf8'));
    expect(userFile.mcpServers.docs).toEqual({
      command: 'npx',
      args: ['-y', 'docs-mcp'],
    });
    expect(fs.existsSync(path.join(cwd, '.opencode', 'opencode.json'))).toBe(false);
    expect(fs.existsSync(path.join(home, '.config', 'opencode'))).toBe(false);
  });

  it('creates project servers in <cwd>/.mcp.json', () => {
    const home = makeTemp();
    const cwd = path.join(home, 'project');
    fs.mkdirSync(cwd, { recursive: true });
    createAdapterMcpConfig({
      home,
      cwd,
      name: 'repo',
      scope: 'project',
      config: { type: 'local', command: ['uvx', 'repo-mcp'] },
    });
    const projectFile = JSON.parse(fs.readFileSync(path.join(cwd, '.mcp.json'), 'utf8'));
    expect(projectFile.mcpServers.repo).toEqual({ command: 'uvx', args: ['repo-mcp'] });
  });

  it('updates and deletes the owning file, including a Pi override definition', () => {
    const home = makeTemp();
    const cwd = path.join(home, 'project');
    const overridePath = path.join(cwd, '.pi', 'mcp.json');
    writeJson(overridePath, {
      mcpServers: { owned: { command: 'node', args: ['server.js'], env: { TOKEN: 'secret' } } },
    });
    updateAdapterMcpConfig({
      home,
      cwd,
      name: 'owned',
      updates: { command: ['node', 'other.js'], environment: { TOKEN: 'secret' } },
    });
    const afterUpdate = JSON.parse(fs.readFileSync(overridePath, 'utf8'));
    expect(afterUpdate.mcpServers.owned.command).toBe('node');
    expect(afterUpdate.mcpServers.owned.args).toEqual(['other.js']);
    expect(afterUpdate.mcpServers.owned.env.TOKEN).toBe('secret');
    deleteAdapterMcpConfig({ home, cwd, name: 'owned' });
    expect(JSON.parse(fs.readFileSync(overridePath, 'utf8')).mcpServers).toBeUndefined();
  });

  it('persists enable/disable only on <cwd>/.pi/mcp.json without copying credentials', () => {
    const home = makeTemp();
    const cwd = path.join(home, 'project');
    const sourcePath = path.join(home, '.config', 'mcp', 'mcp.json');
    writeJson(sourcePath, {
      mcpServers: {
        linear: {
          url: 'https://mcp.linear.app/mcp',
          auth: 'oauth',
          oauth: { clientId: 'abc' },
          env: { LINEAR_API_KEY: 'secret' },
        },
      },
    });
    setAdapterMcpEnabled({ home, cwd, name: 'linear', enabled: false });
    const source = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
    expect(source.mcpServers.linear.env.LINEAR_API_KEY).toBe('secret');
    expect(source.mcpServers.linear.disabled).toBeUndefined();
    const override = JSON.parse(fs.readFileSync(path.join(cwd, '.pi', 'mcp.json'), 'utf8'));
    expect(override.mcpServers.linear).toEqual({ disabled: true });
    expect(getAdapterMcpConfig({ home, cwd, name: 'linear' }).enabled).toBe(false);

    setAdapterMcpEnabled({ home, cwd, name: 'linear', enabled: true });
    expect(JSON.parse(fs.readFileSync(path.join(cwd, '.pi', 'mcp.json'), 'utf8')).mcpServers).toBeUndefined();
    expect(getAdapterMcpConfig({ home, cwd, name: 'linear' }).enabled).toBe(true);
  });

  it('does not rewrite the owning file when the only update is enabled', () => {
    const home = makeTemp();
    const cwd = path.join(home, 'project');
    const sourcePath = path.join(home, '.config', 'mcp', 'mcp.json');
    writeJson(sourcePath, {
      mcpServers: {
        docs: { command: 'npx', args: ['docs'], extra: 'keep-me', env: { TOKEN: 'secret' } },
      },
    });
    updateAdapterMcpConfig({ home, cwd, name: 'docs', updates: { enabled: false } });
    const source = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
    expect(source.mcpServers.docs).toEqual({
      command: 'npx',
      args: ['docs'],
      extra: 'keep-me',
      env: { TOKEN: 'secret' },
    });
    expect(JSON.parse(fs.readFileSync(path.join(cwd, '.pi', 'mcp.json'), 'utf8')).mcpServers.docs).toEqual({
      disabled: true,
    });
  });

  it('writes disabled:false when a lower layer is already disabled', () => {
    const home = makeTemp();
    const cwd = path.join(home, 'project');
    writeJson(path.join(home, '.config', 'mcp', 'mcp.json'), {
      mcpServers: { docs: { command: 'npx', args: ['docs'], disabled: true } },
    });
    setAdapterMcpEnabled({ home, cwd, name: 'docs', enabled: true });
    const override = JSON.parse(fs.readFileSync(path.join(cwd, '.pi', 'mcp.json'), 'utf8'));
    expect(override.mcpServers.docs).toEqual({ disabled: false });
    expect(getAdapterMcpConfig({ home, cwd, name: 'docs' }).enabled).toBe(true);
  });

  it('maps leftover config files to cached/disabled status without inventing connected', () => {
    const configs = [
      { name: 'ready', enabled: true },
      { name: 'off', enabled: false },
    ];
    expect(statusMapFromAdapterConfigs(configs)).toEqual({
      ready: { status: 'cached' },
      off: { status: 'disabled' },
    });
  });
});
