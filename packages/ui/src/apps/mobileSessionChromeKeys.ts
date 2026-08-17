import type { I18nKey } from '@/lib/i18n';

/**
 * Desktop sidebar keys reused by mobile session chrome so Archive / Refresh /
 * Scheduled / Multi-run wording cannot drift. MobileSessionsSheet mounts those
 * actions; untitled is already shared.
 */
export const MOBILE_SESSION_CHROME_KEYS = {
  archive: 'sessions.sidebar.nav.archive',
  refresh: 'sessions.sidebar.footer.actions.refresh',
  scheduledTasks: 'sessions.sidebar.header.actions.scheduledTasks',
  newMultiRun: 'sessions.sidebar.header.actions.newMultiRun',
  untitled: 'sessions.sidebar.session.untitled',
} as const satisfies Record<string, I18nKey>;
