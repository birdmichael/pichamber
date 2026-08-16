const fs = require('node:fs');
const path = require('node:path');

module.exports = (context) => {
  const resourcesPath = context.electronPlatformName === 'darwin'
    ? path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, 'Contents', 'Resources')
    : path.join(context.appOutDir, 'resources');
  if (context.electronPlatformName !== 'darwin') return;

  const sourceAssetsPath = path.join(__dirname, '..', 'resources', 'icons', 'Assets.car');

  if (!fs.existsSync(sourceAssetsPath)) {
    console.warn(`Skipping Assets.car copy; compile it on macOS with generate:macos-icon (${sourceAssetsPath})`);
    return;
  }

  fs.copyFileSync(sourceAssetsPath, path.join(resourcesPath, 'Assets.car'));
};
