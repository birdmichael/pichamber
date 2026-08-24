/**
 * Pure decision helpers for the OpenCode update toast and PWA install toast.
 *
 * Extracted from `OpenCodeUpdateToast.tsx` and `usePwaInstallPrompt.ts` so the
 * dedup decisions can be unit-tested without a DOM, storage, or React. The
 * React surfaces remain the sole owners of side effects (storage writes,
 * `toast.info`, event listeners). This module only answers the question
 * "given these inputs, should we show the toast?".
 *
 * Exposed for unit testing. Not part of the stable consumer surface.
 */

export interface PwaInstallToastDecisionInput {
  /** Persistent localStorage entry: `'true'` when the user dismissed once. */
  readonly dismissed: string | null;
  /** Session-scoped sessionStorage flag set the first time the toast is shown in this tab. */
  readonly sessionShown: string | null;
  /** Whether the current React effect already holds a toast id. */
  readonly hasActiveToast: boolean;
}

/**
 * Returns `true` if the PWA install prompt toast should be shown for the
 * incoming `beforeinstallprompt` event.
 *
 * The decision composes three gates (any failure short-circuits):
 *  1. Persistent dismissal wins for all future visits.
 *  2. Per-tab dedup avoids re-showing inside the same browsing session.
 *  3. Re-entrancy guard prevents stacking when the effect already owns one.
 */
export const shouldShowPwaInstallToast = (input: PwaInstallToastDecisionInput): boolean => {
  if (input.dismissed === 'true') return false;
  if (input.sessionShown === 'true') return false;
  if (input.hasActiveToast) return false;
  return true;
};

export interface OpenCodeUpdateToastDecisionInput {
  /** Version string reported by the server (already trimmed by the caller). */
  readonly version: string;
  /** Most recent version the user explicitly dismissed, or `null` if none. */
  readonly dismissedVersion: string | null;
  /** Set of versions already surfaced in this tab session. */
  readonly seenVersions: ReadonlySet<string>;
}

/**
 * Strips a leading `v` and surrounding whitespace so Pi / npm / stored
 * versions compare as the same release.
 */
export const normalizeOpenCodeUpdateVersion = (version: string | null | undefined): string => {
  if (typeof version !== 'string') return '';
  return version.trim().replace(/^v/i, '');
};

const parseVersionForComparison = (value: string) => {
  const raw = normalizeOpenCodeUpdateVersion(value);
  const prereleaseIndex = raw.search(/[-+]/);
  const core = prereleaseIndex >= 0 ? raw.slice(0, prereleaseIndex) : raw;
  const parts = core.split('.').map((part) => {
    const parsed = Number.parseInt(part, 10);
    return Number.isFinite(parsed) ? parsed : 0;
  });
  return { parts, prerelease: prereleaseIndex >= 0 };
};

/**
 * Orders two update versions. Positive means `left` is newer than `right`.
 * A prerelease of the same core version is treated as older.
 */
export const compareOpenCodeUpdateVersions = (left: string, right: string): number => {
  const a = parseVersionForComparison(left);
  const b = parseVersionForComparison(right);
  const length = Math.max(a.parts.length, b.parts.length);
  for (let index = 0; index < length; index += 1) {
    const diff = (a.parts[index] || 0) - (b.parts[index] || 0);
    if (diff !== 0) return diff;
  }
  if (a.prerelease !== b.prerelease) return a.prerelease ? -1 : 1;
  return 0;
};

let rememberedDismissedVersion: string | null = null;

/** Test-only: clear the in-memory dismiss so cases do not leak across files. */
export const resetRememberedOpenCodeUpdateDismiss = (): void => {
  rememberedDismissedVersion = null;
};

/**
 * Records that the user dismissed `version` in this JS realm. Survives
 * component remounts and toast-id recreation until a full reload.
 */
export const rememberOpenCodeUpdateToastDismiss = (version: string): string => {
  const normalized = normalizeOpenCodeUpdateVersion(version);
  if (!normalized) return '';
  rememberedDismissedVersion = normalized;
  return normalized;
};

/**
 * Prefers the newer of the persisted dismiss and the in-memory dismiss so a
 * late settings sync cannot resurrect a version the user already hid.
 */
export const resolveDismissedOpenCodeUpdateVersion = (stored: string | null | undefined): string | null => {
  const storedVersion = normalizeOpenCodeUpdateVersion(stored);
  const remembered = rememberedDismissedVersion;
  if (!storedVersion) return remembered;
  if (!remembered) return storedVersion;
  return compareOpenCodeUpdateVersions(storedVersion, remembered) >= 0 ? storedVersion : remembered;
};

export interface OpenCodeUpdateToastDismissInput {
  readonly version: string;
  readonly persistDismissedVersion: (version: string) => void;
  readonly hideToast: () => void;
}

/**
 * Persist-and-hide path for Dismiss, the toast OK/close control, and
 * `onDismiss`. Idempotent for the same version.
 */
export const dismissOpenCodeUpdateToast = (input: OpenCodeUpdateToastDismissInput): string => {
  const version = rememberOpenCodeUpdateToastDismiss(input.version);
  if (version) {
    input.persistDismissedVersion(version);
  }
  input.hideToast();
  return version;
};

/**
 * Returns `true` if the OpenCode update toast should be shown for `version`.
 *
 * Empty/whitespace-only versions short-circuit to `false`. A dismissed
 * version hides that release and any older one; a newer release surfaces
 * again. `seenVersions` still dedups the same tab session, including
 * `v`-prefixed aliases of a version already shown.
 */
export const shouldShowOpenCodeUpdateToast = (
  input: OpenCodeUpdateToastDecisionInput,
): boolean => {
  const version = normalizeOpenCodeUpdateVersion(input.version);
  if (!version) return false;
  for (const seen of input.seenVersions) {
    if (normalizeOpenCodeUpdateVersion(seen) === version) return false;
  }
  const dismissedVersion = normalizeOpenCodeUpdateVersion(input.dismissedVersion);
  if (dismissedVersion && compareOpenCodeUpdateVersions(version, dismissedVersion) <= 0) {
    return false;
  }
  return true;
};

/**
 * Coerces the `detail.version` carried by an `openchamber:opencode-update-available`
 * CustomEvent into a trimmed string, or returns `''` when the payload is
 * missing or shaped unexpectedly.
 *
 * Only `string` is accepted; numeric or boolean payloads are rejected because
 * downstream callers compare versions by literal equality.
 */
export const resolveOpenCodeUpdateVersion = (detail: unknown): string => {
  if (detail === null || typeof detail !== 'object') return '';
  const candidate = (detail as { version?: unknown }).version;
  if (typeof candidate !== 'string') return '';
  return candidate.trim();
};

export interface OpenCodeUpgradeStatusLike {
  readonly available?: boolean | null;
  readonly latestVersion?: string | null;
  readonly upgrade?: {
    readonly supported?: boolean | null;
  } | null;
}

/**
 * Pulls the candidate version out of an `/api/opencode/upgrade-status` JSON
 * payload. Returns `''` when the payload is missing the field, has the wrong
 * type, or reports `available !== true`.
 */
export const resolveOpenCodeUpgradeStatusVersion = (
  status: OpenCodeUpgradeStatusLike | null | undefined,
): string => {
  if (!status) return '';
  if (status.upgrade?.supported !== true) return '';
  if (status.available !== true) return '';
  if (typeof status.latestVersion !== 'string') return '';
  return status.latestVersion.trim();
};

/**
 * Pulls the candidate version out of an `/api/pi/upgrade-status` JSON
 * payload. The bundled SDK cannot be upgraded in-app, so this ignores
 * `upgrade.supported` and only requires `available === true`.
 */
export const resolvePiUpgradeStatusVersion = (
  status: OpenCodeUpgradeStatusLike | null | undefined,
): string => {
  if (!status) return '';
  if (status.available !== true) return '';
  if (typeof status.latestVersion !== 'string') return '';
  return status.latestVersion.trim();
};
