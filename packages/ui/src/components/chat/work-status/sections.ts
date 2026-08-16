import type { I18nKey } from '@/lib/i18n/messages/en';

/**
 * Every section the work-status panel can render, in display order.
 *
 * One list drives both the panel and its settings dialog, so a section cannot
 * exist in the panel without being switchable, or appear in the dialog without
 * existing. Kernel availability (`isWorkStatusSectionAvailable`) filters that
 * list before either surface sees it.
 *
 * The ids are persisted in user settings — renaming one silently resets that
 * user's choice for it.
 */
export const WORK_STATUS_SECTION_IDS = [
  'session',
  'repository',
  'usage',
  'subagents',
  'tasks',
  'mcp',
  'pinned',
  'contextSources',
] as const;

export type WorkStatusSectionId = (typeof WORK_STATUS_SECTION_IDS)[number];

export type WorkStatusSectionContext = {
  /** Pi has no provider-quota API; the OpenCode usage section is unavailable. */
  isPiKernel?: boolean;
};

/**
 * Provider-quota usage is an OpenCode API. Pi has no quota source, so that
 * section is not offered — session context % / cost stay in the Session block.
 */
export const isWorkStatusSectionAvailable = (
  id: WorkStatusSectionId,
  context?: WorkStatusSectionContext,
): boolean => !(context?.isPiKernel && id === 'usage');

export const getAvailableWorkStatusSectionIds = (
  context?: WorkStatusSectionContext,
): readonly WorkStatusSectionId[] =>
  WORK_STATUS_SECTION_IDS.filter((id) => isWorkStatusSectionAvailable(id, context));

export const WORK_STATUS_SECTION_LABEL_KEYS: Record<WorkStatusSectionId, I18nKey> = {
  session: 'chat.workStatus.section.session',
  repository: 'chat.workStatus.section.project',
  usage: 'chat.workStatus.section.usage',
  subagents: 'chat.workStatus.section.subagents',
  tasks: 'chat.workStatus.section.tasks',
  mcp: 'chat.workStatus.section.mcp',
  pinned: 'chat.workStatus.section.pinned',
  contextSources: 'chat.workStatus.section.contextBreakdown',
};

const KNOWN_IDS = new Set<string>(WORK_STATUS_SECTION_IDS);

const isWorkStatusSectionId = (value: unknown): value is WorkStatusSectionId =>
  typeof value === 'string' && KNOWN_IDS.has(value);

/**
 * Hidden sections are stored, not visible ones: everything is on by default, so
 * an empty list means "the user has changed nothing" and a section added later
 * appears without touching anyone's saved settings.
 */
export const isWorkStatusSectionVisible = (
  hidden: readonly string[] | null | undefined,
  id: WorkStatusSectionId,
  context?: WorkStatusSectionContext,
): boolean => isWorkStatusSectionAvailable(id, context) && !hidden?.includes(id);

/**
 * True when every *available* section id appears in the hidden set.
 *
 * Uses `.every()` instead of a length comparison so that stale ids left over
 * from a removed section cannot inflate the count past the current list length.
 * Kernel-unavailable sections (provider usage on Pi) are ignored so hiding the
 * remaining rows can still recover the empty-state controls.
 */
export const areAllWorkStatusSectionsHidden = (
  hidden: readonly string[] | null | undefined,
  context?: WorkStatusSectionContext,
): boolean =>
  hidden != null &&
  getAvailableWorkStatusSectionIds(context).every((id) => hidden.includes(id));

export const getWorkStatusPanelPresentation = ({
  visible,
  contentMounted,
  renderedSections,
  allSectionsHidden,
}: {
  visible: boolean;
  contentMounted: boolean;
  renderedSections: number;
  allSectionsHidden: boolean;
}): { interactive: boolean; showEmptyState: boolean } => ({
  interactive: visible && (renderedSections > 0 || allSectionsHidden),
  showEmptyState: contentMounted && allSectionsHidden,
});

export const sanitizeWorkStatusHiddenSections = (value: unknown): WorkStatusSectionId[] => {
  if (!Array.isArray(value)) return [];
  const seen = new Set<WorkStatusSectionId>();
  for (const entry of value) {
    if (isWorkStatusSectionId(entry)) seen.add(entry);
  }
  return [...seen];
};
