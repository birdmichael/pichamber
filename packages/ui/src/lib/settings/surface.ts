import { isDesktopShell, isVSCodeRuntime } from '@/lib/desktop';
import { isCapacitorApp } from '@/lib/platform';
import { isMobileSurfaceRuntime } from '@/lib/runtimeSurface';

/**
 * Settings surface kinds that can hold their own theme / font-size / chat-layout
 * profile values (OpenChamber 1.23 per-surface prefs). Desktop is the primary
 * slice; mobile/vscode/web share the same storage shape for forward compatibility.
 */
export type SettingsSurface = 'web' | 'desktop' | 'vscode' | 'mobile';

/**
 * Query parameter that tells the server which surface kind a client is
 * (`/api/config/settings?surface=desktop`). A query parameter rather than a
 * header keeps the request CORS-simple for the packaged desktop shell.
 */
export const SETTINGS_SURFACE_QUERY = 'surface';

/**
 * Which surface kind this client is, for per-surface profile fields: a change
 * made here is stored for this kind only.
 */
export const getSettingsSurface = (): SettingsSurface => {
  try {
    if (isVSCodeRuntime()) return 'vscode';
    if (isDesktopShell()) return 'desktop';
    if (isCapacitorApp() || isMobileSurfaceRuntime()) return 'mobile';
  } catch {
    // Detectors read window.location; outside a real browser the plain web kind applies.
  }
  return 'web';
};
