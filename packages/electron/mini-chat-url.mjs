const originOf = (value) => {
  try {
    return value ? new URL(value).origin : '';
  } catch {
    return '';
  }
};

const addOrigin = (origins, value) => {
  const origin = originOf(value);
  if (origin) origins.add(origin);
};

// Mini Chat must load the renderer UI origin (Vite HMR in electron-dev,
// packaged custom protocol in a release), not the API sidecar. The sidecar
// 404s /mini-chat.html with "Static files not found" when packages/web/dist
// is not built.
export const resolveMiniChatUiBase = ({
  packaged = false,
  packagedUrl = '',
  uiOrigin = '',
  localOrigin = '',
  sidecarUrl = '',
  hmrUiOrigin = '',
} = {}) => {
  if (packaged) return packagedUrl || '';
  return uiOrigin || hmrUiOrigin || localOrigin || sidecarUrl || '';
};

export const buildMiniChatPageUrl = ({
  base,
  packaged = false,
  mode,
  sessionId,
  directory,
  projectId,
} = {}) => {
  if (!base) {
    throw new Error('Local UI is not available');
  }
  const url = new URL(packaged ? base : '/mini-chat.html', base);
  url.searchParams.set('mode', mode === 'session' ? 'session' : 'draft');
  if (sessionId) url.searchParams.set('sessionId', sessionId);
  if (directory) url.searchParams.set('directory', directory);
  if (projectId) url.searchParams.set('projectId', projectId);
  return url.toString();
};

export const isAllowedMiniChatNavigationUrl = ({
  url,
  packaged = false,
  packagedOrigin = '',
  uiOrigin = '',
  localOrigin = '',
  sidecarUrl = '',
  currentUrl = '',
  hmrUiOrigin = '',
} = {}) => {
  try {
    const targetOrigin = new URL(url).origin;
    const allowed = new Set();
    if (packaged) {
      addOrigin(allowed, packagedOrigin);
    } else {
      addOrigin(allowed, uiOrigin);
      addOrigin(allowed, hmrUiOrigin);
      addOrigin(allowed, localOrigin);
      addOrigin(allowed, sidecarUrl);
    }
    addOrigin(allowed, currentUrl);
    return allowed.has(targetOrigin);
  } catch {
    return false;
  }
};
