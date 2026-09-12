/**
 * Desktop-first per-surface theme / fonts / chat-layout overlay for settings.json.
 *
 * OpenChamber 1.23 stores these under preferences.json field entries
 * (`surfaces.<kind>`). Pichamber keeps a flatter settings.json and nests the
 * same overlay under `surfaceProfiles` so Desktop can diverge without a full
 * preferences-registry split. Device-local panel sizes stay elsewhere.
 */

export const SETTINGS_SURFACES = Object.freeze(['web', 'desktop', 'vscode', 'mobile']);

export const SURFACE_PROFILES_KEY = 'surfaceProfiles';

/** Keys OpenChamber marks `perSurface` that belong to theme / fonts / chat layout. */
export const PER_SURFACE_PROFILE_KEYS = Object.freeze([
  'themeId',
  'useSystemTheme',
  'lightThemeId',
  'darkThemeId',
  'streamingAutoFollowEnabled',
  'stickyUserHeader',
  'promptNavigatorEnabled',
  'wideChatLayoutEnabled',
  'fontSize',
  'terminalFontSize',
  'editorFontSize',
  'padding',
  'cornerRadius',
]);

const PER_SURFACE_KEY_SET = new Set(PER_SURFACE_PROFILE_KEYS);

export const isPerSurfaceProfileKey = (key) => PER_SURFACE_KEY_SET.has(key);

export const normalizeSettingsSurface = (value) => (
  typeof value === 'string' && SETTINGS_SURFACES.includes(value.trim()) ? value.trim() : null
);

/**
 * Which surface kind a settings request comes from; `null` means "base".
 * Clients send `?surface=<kind>`; `x-openchamber-surface` is still honoured.
 */
export const settingsSurfaceOf = (req) => (
  normalizeSettingsSurface(req?.query?.surface)
  ?? normalizeSettingsSurface(typeof req?.get === 'function' ? req.get('x-openchamber-surface') : null)
);

const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

/** Strip the overlay bag so clients never see the internal storage key. */
export const stripSurfaceProfiles = (document) => {
  if (!document || typeof document !== 'object') return {};
  if (!Object.prototype.hasOwnProperty.call(document, SURFACE_PROFILES_KEY)) {
    return { ...document };
  }
  const next = { ...document };
  delete next[SURFACE_PROFILES_KEY];
  return next;
};

/**
 * Flat view for one surface kind: that kind's overlay wins, then base.
 * Without a surface, return the base document (overlay stripped).
 */
export const resolveSettingsForSurface = (document, surface = null) => {
  const base = stripSurfaceProfiles(document);
  const kind = normalizeSettingsSurface(surface);
  if (!kind) return base;
  const profiles = document?.[SURFACE_PROFILES_KEY];
  if (!isPlainObject(profiles) || !isPlainObject(profiles[kind])) return base;
  const overlay = {};
  for (const [key, value] of Object.entries(profiles[kind])) {
    if (!isPerSurfaceProfileKey(key) || value === undefined) continue;
    overlay[key] = value;
  }
  return { ...base, ...overlay };
};

/**
 * After a normal merge into the flat document, move per-surface keys from the
 * write into `surfaceProfiles[surface]` and restore the previous base values
 * so other surfaces keep reading the shared baseline until they write.
 */
export const commitPerSurfaceProfileWrite = (before, after, sanitizedChanges, surface) => {
  const kind = normalizeSettingsSurface(surface);
  if (!kind || !sanitizedChanges || typeof sanitizedChanges !== 'object') {
    return after;
  }

  const changedPerSurface = Object.keys(sanitizedChanges).filter(isPerSurfaceProfileKey);
  if (changedPerSurface.length === 0) {
    return after;
  }

  const previousProfiles = isPlainObject(before?.[SURFACE_PROFILES_KEY])
    ? before[SURFACE_PROFILES_KEY]
    : {};
  const previousOwn = isPlainObject(previousProfiles[kind]) ? previousProfiles[kind] : {};
  const own = { ...previousOwn };
  const out = { ...after };

  for (const key of changedPerSurface) {
    own[key] = sanitizedChanges[key];
    if (Object.prototype.hasOwnProperty.call(before ?? {}, key)) {
      out[key] = before[key];
    } else {
      delete out[key];
    }
  }

  out[SURFACE_PROFILES_KEY] = {
    ...previousProfiles,
    [kind]: own,
  };
  return out;
};
