/**
 * Body-level stacking context only. A host inside the header column loses to
 * that ancestor's overflow / transform / isolation even with position:fixed.
 */
export const resolveUpdateAvailableBannerPortalTarget = (
  doc: { body?: HTMLElement | null } | null | undefined,
): HTMLElement | null => doc?.body ?? null;
