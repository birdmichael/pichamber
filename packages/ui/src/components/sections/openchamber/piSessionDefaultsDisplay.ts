/** Live catalog keys are `providerId/modelId` (same shape as GET /api/pi/defaults). */

export const pickPiSessionDefaultModel = (
  stored: string | undefined,
  resolved: string | undefined,
  catalogKeys: readonly string[] = [],
): string => {
  const pinned = typeof stored === 'string' ? stored.trim() : '';
  const live = typeof resolved === 'string' ? resolved.trim() : '';
  if (catalogKeys.length > 0) {
    if (pinned && catalogKeys.includes(pinned)) return pinned;
    if (live && catalogKeys.includes(live)) return live;
    return catalogKeys[0] || live || pinned || '';
  }
  // Before the catalog arrives, never paint a stored placeholder over resolvedModel.
  return live || pinned || '';
};

export const filterPiEnabledModelsToCatalog = (
  enabled: readonly string[] | undefined,
  catalogKeys: readonly string[],
): string[] => {
  const list = Array.isArray(enabled)
    ? enabled.map((item) => (typeof item === 'string' ? item.trim() : '')).filter(Boolean)
    : [];
  if (catalogKeys.length === 0) return list;
  const allowed = new Set(catalogKeys);
  return list.filter((id) => allowed.has(id));
};
