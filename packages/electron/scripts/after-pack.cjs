const fs = require('node:fs');
const path = require('node:path');

const { stagePackagedNodeKernelDeps } = require('./unpack-node-kernel-deps.cjs');

module.exports = (context) => {
  const resourcesPath = context.electronPlatformName === 'darwin'
    ? path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, 'Contents', 'Resources')
    : path.join(context.appOutDir, 'resources');

  const electronRoot = path.resolve(__dirname, '..');
  const searchRoots = [
    electronRoot,
    path.resolve(electronRoot, '../web'),
    path.resolve(electronRoot, '../..'),
  ];

  const staged = stagePackagedNodeKernelDeps({ resourcesPath, searchRoots });
  console.log(
    `[electron] afterPack ${context.electronPlatformName}: ${staged.names.length} kernel deps, staged ${staged.staged.length}`,
  );
  if (staged.staged.length > 0) {
    console.log(`[electron] unpacked Pi kernel Node deps: ${staged.staged.join(', ')}`);
  }

  if (context.electronPlatformName !== 'darwin') return;

  const sourceAssetsPath = path.join(__dirname, '..', 'resources', 'icons', 'Assets.car');
  if (!fs.existsSync(sourceAssetsPath)) {
    console.warn(`Skipping Assets.car copy; compile it on macOS with generate:macos-icon (${sourceAssetsPath})`);
    return;
  }

  fs.copyFileSync(sourceAssetsPath, path.join(resourcesPath, 'Assets.car'));
};
