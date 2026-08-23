export const resolveEffectiveSingleProjectId = (
  isSingleProjectMode: boolean,
  singleProjectId: string | null,
  activeProjectId: string | null,
  projectIds: ReadonlyArray<string>,
): string | null => {
  if (!isSingleProjectMode) return null;
  if (singleProjectId && projectIds.includes(singleProjectId)) {
    return singleProjectId;
  }
  if (activeProjectId && projectIds.includes(activeProjectId)) {
    return activeProjectId;
  }
  return projectIds[0] ?? null;
};
