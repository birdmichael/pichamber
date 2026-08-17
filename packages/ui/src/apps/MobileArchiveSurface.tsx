import React from 'react';
import type { Session } from '@opencode-ai/sdk/v2';

import { Icon } from '@/components/icon/Icon';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollShadow } from '@/components/ui/ScrollShadow';
import { toast } from '@/components/ui';
import { formatSessionDateLabel, normalizePath } from '@/components/session/sidebar/utils';
import { useI18n } from '@/lib/i18n';
import { cn, formatDirectoryName } from '@/lib/utils';
import { useDirectoryStore } from '@/stores/useDirectoryStore';
import { useUIStore } from '@/stores/useUIStore';
import {
  refreshArchivedSessions,
  resolveGlobalSessionDirectory,
  useGlobalSessionsStore,
} from '@/stores/useGlobalSessionsStore';
import { useSessionUIStore } from '@/sync/session-ui-store';
import { useShallow } from 'zustand/react/shallow';

import { MOBILE_SESSION_CHROME_KEYS } from './mobileSessionChromeKeys';
import { filterArchivedSessions, sortArchivedSessionsByTime } from '@/components/views/archiveSessionList';

type DirectoryBucket = {
  directory: string;
  label: string;
  count: number;
};

const PAGE_SIZE = 50;

export const MobileArchiveSurface: React.FC<{
  onOpenSession?: () => void;
}> = ({ onOpenSession }) => {
  const { t } = useI18n();
  const open = useUIStore((state) => state.isArchivePageOpen);
  const setOpen = useUIStore((state) => state.setArchivePageOpen);
  const setCurrentSession = useSessionUIStore((state) => state.setCurrentSession);
  const unarchiveSession = useSessionUIStore((state) => state.unarchiveSession);
  const homeDirectory = useDirectoryStore((state) => state.homeDirectory);
  const archivedSessions = useGlobalSessionsStore(useShallow((state) => (
    open ? state.archivedSessions : []
  )));

  React.useEffect(() => {
    if (!open) return;
    void refreshArchivedSessions();
  }, [open]);

  const [query, setQuery] = React.useState('');
  const [selectedDirectory, setSelectedDirectory] = React.useState<string | null>(null);
  const [visibleCount, setVisibleCount] = React.useState(PAGE_SIZE);
  const [restoringId, setRestoringId] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (open) return;
    setQuery('');
    setSelectedDirectory(null);
    setVisibleCount(PAGE_SIZE);
    setRestoringId(null);
  }, [open]);

  const sessionDirectory = React.useCallback((session: Session): string => (
    normalizePath(resolveGlobalSessionDirectory(session)) ?? ''
  ), []);

  const sortedSessions = React.useMemo(() => (
    open ? sortArchivedSessionsByTime(archivedSessions) : []
  ), [archivedSessions, open]);

  const buckets = React.useMemo<DirectoryBucket[]>(() => {
    const byDirectory = new Map<string, DirectoryBucket>();
    for (const session of sortedSessions) {
      const directory = sessionDirectory(session);
      const existing = byDirectory.get(directory);
      if (existing) {
        existing.count += 1;
        continue;
      }
      byDirectory.set(directory, {
        directory,
        label: directory
          ? (formatDirectoryName(directory, homeDirectory) || directory)
          : t('sessions.archivePage.otherProjects'),
        count: 1,
      });
    }
    return [...byDirectory.values()].sort((a, b) => b.count - a.count);
  }, [homeDirectory, sessionDirectory, sortedSessions, t]);

  const filteredSessions = React.useMemo(() => (
    filterArchivedSessions(sortedSessions, {
      query,
      selectedDirectory,
      getDirectory: sessionDirectory,
    })
  ), [query, selectedDirectory, sessionDirectory, sortedSessions]);

  const visibleSessions = filteredSessions.slice(0, visibleCount);
  const remainingCount = filteredSessions.length - visibleSessions.length;

  const openSession = React.useCallback((session: Session) => {
    const directory = sessionDirectory(session);
    void setCurrentSession(session.id, directory || undefined);
    setOpen(false);
    onOpenSession?.();
  }, [onOpenSession, sessionDirectory, setCurrentSession, setOpen]);

  const restoreSession = React.useCallback((session: Session) => {
    setRestoringId(session.id);
    void unarchiveSession(session.id).then((success) => {
      if (success) toast.success(t('sessions.sidebar.session.restore.success'));
      else toast.error(t('sessions.sidebar.session.restore.error'));
    }).finally(() => {
      setRestoringId((current) => (current === session.id ? null : current));
    });
  }, [t, unarchiveSession]);

  if (!open) return null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 px-4 pb-2 pt-1">
        <div className="relative">
          <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setVisibleCount(PAGE_SIZE);
            }}
            placeholder={t('sessions.archivePage.searchPlaceholder')}
            className={cn('h-11 pl-9', query && 'pr-10')}
          />
          {query ? (
            <button
              type="button"
              className="absolute right-1.5 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-interactive-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              aria-label={t('mobile.sessions.clearSearchAria')}
              onClick={() => setQuery('')}
              style={{ touchAction: 'manipulation' }}
            >
              <Icon name="close" className="size-4" />
            </button>
          ) : null}
        </div>
        <p className="px-1 pt-2 typography-micro text-muted-foreground">
          {filteredSessions.length === 1
            ? t('sessions.archivePage.countSingle', { count: filteredSessions.length })
            : t('sessions.archivePage.countPlural', { count: filteredSessions.length })}
        </p>
      </div>

      {buckets.length > 1 && !query.trim() ? (
        <div className="flex shrink-0 gap-1.5 overflow-x-auto px-4 pb-2">
          <Button
            type="button"
            variant="chip"
            size="sm"
            aria-pressed={selectedDirectory === null}
            onClick={() => {
              setSelectedDirectory(null);
              setVisibleCount(PAGE_SIZE);
            }}
            style={{ touchAction: 'manipulation' }}
          >
            {t('sessions.archivePage.allDirectories')}
          </Button>
          {buckets.map((bucket) => (
            <Button
              key={bucket.directory || '__none__'}
              type="button"
              variant="chip"
              size="sm"
              aria-pressed={selectedDirectory === bucket.directory}
              onClick={() => {
                setSelectedDirectory(bucket.directory);
                setVisibleCount(PAGE_SIZE);
              }}
              style={{ touchAction: 'manipulation' }}
            >
              <span className="max-w-40 truncate">{bucket.label}</span>
              <span className="tabular-nums text-muted-foreground">{bucket.count}</span>
            </Button>
          ))}
        </div>
      ) : null}

      <ScrollShadow className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
        {visibleSessions.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
            <p className="typography-ui-label text-foreground">
              {query.trim()
                ? t('sessions.archivePage.empty.noMatches')
                : t('sessions.archivePage.empty.noArchived')}
            </p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-border/70 bg-[var(--surface-elevated)]">
            {visibleSessions.map((session, index) => {
              const directory = sessionDirectory(session);
              const directoryLabel = directory
                ? (formatDirectoryName(directory, homeDirectory) || directory)
                : t('sessions.archivePage.otherProjects');
              const title = session.title?.trim() || t(MOBILE_SESSION_CHROME_KEYS.untitled);
              const restoring = restoringId === session.id;
              return (
                <div
                  key={session.id}
                  className={cn(
                    'flex items-center gap-2 px-2 py-1.5',
                    index > 0 && 'border-t border-border/70',
                  )}
                >
                  <button
                    type="button"
                    className="flex min-h-11 min-w-0 flex-1 flex-col items-start justify-center px-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
                    onClick={() => openSession(session)}
                    style={{ touchAction: 'manipulation' }}
                  >
                    <span className="block w-full truncate typography-ui-label text-foreground">{title}</span>
                    <span className="block w-full truncate typography-micro text-muted-foreground">
                      {directoryLabel}
                      {' · '}
                      {formatSessionDateLabel(session.time?.archived ?? session.time?.updated ?? session.time?.created ?? Date.now())}
                    </span>
                  </button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={restoring}
                    aria-label={t('sessions.archivePage.restoreSessionAria', { title })}
                    onClick={() => void restoreSession(session)}
                    style={{ touchAction: 'manipulation' }}
                  >
                    <Icon name="inbox-unarchive" className="size-4" />
                    {t('sessions.sidebar.bulkActions.restore')}
                  </Button>
                </div>
              );
            })}
          </div>
        )}
        {remainingCount > 0 ? (
          <button
            type="button"
            className="mt-2 flex min-h-10 w-full items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-interactive-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            onClick={() => setVisibleCount((count) => count + PAGE_SIZE)}
            style={{ touchAction: 'manipulation' }}
          >
            {t('sessions.sidebar.group.showMore')}
          </button>
        ) : null}
      </ScrollShadow>
    </div>
  );
};
