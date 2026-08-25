#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const electronRoot = path.resolve(__dirname, '..');
const outputDir = path.join(electronRoot, 'resources', 'node', 'bin');
const outputName = process.platform === 'win32' ? 'node.exe' : 'node';
const outputPath = path.join(outputDir, outputName);

const basenameOf = (filePath) => path.basename(filePath || '').toLowerCase();

const isNodeBinary = (filePath) => {
  const name = basenameOf(filePath);
  return name === 'node' || name === 'node.exe';
};

const resolveSourceNode = () => {
  const override = typeof process.env.PICHAMBER_NODE_BINARY === 'string'
    ? process.env.PICHAMBER_NODE_BINARY.trim()
    : '';
  if (override && fs.existsSync(override) && isNodeBinary(override)) {
    return path.resolve(override);
  }
  if (isNodeBinary(process.execPath) && fs.existsSync(process.execPath)) {
    return process.execPath;
  }
  const which = spawnSync(process.platform === 'win32' ? 'where' : 'which', (
    process.platform === 'win32' ? ['node'] : ['node']
  ), {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  const line = (which.stdout || '').split(/\r?\n/).map((item) => item.trim()).find(Boolean);
  if (line && fs.existsSync(line) && isNodeBinary(line)) {
    return path.resolve(line);
  }
  throw new Error(
    'Packaged Desktop needs a Node.js binary next to the Pi kernel, but none was found. '
    + 'Install Node.js or set PICHAMBER_NODE_BINARY.',
  );
};

const source = resolveSourceNode();
fs.mkdirSync(outputDir, { recursive: true });
fs.copyFileSync(source, outputPath);
if (process.platform !== 'win32') {
  fs.chmodSync(outputPath, 0o755);
}

console.log(`[electron] staged Node for the Pi kernel: ${outputPath}`);
console.log(`[electron] source: ${source}`);
