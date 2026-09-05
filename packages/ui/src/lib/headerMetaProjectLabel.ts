import { isProjectlessNewSessionDraft } from '@/lib/newSessionInherit';

export type HeaderMetaDraft = {
  open?: boolean;
  target?: 'chat' | 'project' | null;
  selectedProjectId?: string | null;
};

/**
 * Header meta-row project subtitle. For an open projectless New Session draft
 * (Choose project / chats), never paint leftover persisted activeProject
 * (#555) — same spirit as resolveWindowTitleProjectLabel.
 */
export function resolveHeaderMetaProjectLabel(input: {
  draft?: HeaderMetaDraft | null;
  /** Label for the draft's selected project when the draft is a project target. */
  draftProjectLabel?: string | null;
  /** Persisted activeProject label — only for non-draft chrome. */
  activeProjectLabel?: string | null;
}): string | null {
  const draft = input.draft ?? null;
  if (draft?.open) {
    if (isProjectlessNewSessionDraft(draft)) return null;
    const draftLabel = typeof input.draftProjectLabel === 'string' ? input.draftProjectLabel.trim() : '';
    if (draftLabel) return draftLabel;
    return null;
  }
  const active = typeof input.activeProjectLabel === 'string' ? input.activeProjectLabel.trim() : '';
  return active || null;
}
