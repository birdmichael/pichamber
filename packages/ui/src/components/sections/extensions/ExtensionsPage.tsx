import React from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { toast } from '@/components/ui';
import { SettingsPageLayout } from '@/components/sections/shared/SettingsPageLayout';
import {
  SettingsSection,
  SETTINGS_ACTION_BUTTON_CLASS,
  SETTINGS_VERSION_META_CLASS,
} from '@/components/sections/shared/SettingsSection';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { refreshSessionTitleReloadLists } from '@/components/layout/headerSessionReload';
import { shouldShowExtensionsSection } from './extensionsPageVisibility';
import {
  packageDisplayName,
  packageUninstallSource,
  packageVersionState,
  packagesWithUpdates,
  parseExtensionPackages,
  type ExtensionPackageItem,
} from './extensionPackageUpdate';
import { useI18n } from '@/lib/i18n';
import { runtimeFetch } from '@/lib/runtime-fetch';

type ExtensionItem = { name: string; path: string; scope: string };

type BusyState =
  | { kind: 'one'; source: string }
  | { kind: 'all' }
  | { kind: 'uninstall'; source: string }
  | null;

export const ExtensionsPage: React.FC = () => {
  const { t } = useI18n();
  const [extensions, setExtensions] = React.useState<ExtensionItem[]>([]);
  const [packages, setPackages] = React.useState<ExtensionPackageItem[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [busy, setBusy] = React.useState<BusyState>(null);
  const [pendingUninstall, setPendingUninstall] = React.useState<ExtensionPackageItem | null>(null);

  const applyPayload = React.useCallback((data: unknown) => {
    const payload = data && typeof data === 'object' ? data as {
      extensions?: ExtensionItem[];
      packages?: unknown;
    } : null;
    setExtensions(Array.isArray(payload?.extensions) ? payload.extensions : []);
    setPackages(parseExtensionPackages(payload));
  }, []);

  const load = React.useCallback(async () => {
    const response = await runtimeFetch('/api/pi/extensions', { headers: { Accept: 'application/json' } });
    if (!response.ok) {
      const error = new Error('Could not load extensions');
      throw error;
    }
    applyPayload(await response.json().catch(() => null));
  }, [applyPayload]);

  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        await load();
      } catch {
        if (!cancelled) {
          setExtensions([]);
          setPackages([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [load]);

  const runUpdate = React.useCallback(async (source?: string) => {
    if (busy) return;
    const nextBusy: BusyState = source ? { kind: 'one', source } : { kind: 'all' };
    setBusy(nextBusy);
    try {
      const response = await runtimeFetch('/api/pi/extensions/update', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(source ? { source } : {}),
      });
      const raw = await response.json().catch(() => null);
      if (!response.ok) {
        if (response.status === 409) {
          toast.error(t('settings.extensions.page.packages.toast.updateBusy'));
          return;
        }
        const message = raw && typeof raw === 'object' && typeof (raw as { error?: unknown }).error === 'string'
          ? (raw as { error: string }).error
          : (source
            ? t('settings.extensions.page.packages.toast.updateFailed', { name: source })
            : t('settings.extensions.page.packages.toast.updateAllFailed'));
        toast.error(message);
        return;
      }
      applyPayload(raw);
      await refreshSessionTitleReloadLists();
      if (source) {
        const name = packages.find((item) => item.path === source || item.name === source)?.name || source;
        toast.success(t('settings.extensions.page.packages.toast.updateSuccess', { name }));
      } else {
        const count = packagesWithUpdates(packages).length;
        toast.success(count === 1
          ? t('settings.extensions.page.packages.toast.updateAllSuccessOne')
          : t('settings.extensions.page.packages.toast.updateAllSuccess', { count }));
      }
    } catch {
      toast.error(source
        ? t('settings.extensions.page.packages.toast.updateFailed', { name: source })
        : t('settings.extensions.page.packages.toast.updateAllFailed'));
    } finally {
      setBusy(null);
    }
  }, [applyPayload, busy, packages, t]);

  const runUninstall = React.useCallback(async (item: ExtensionPackageItem) => {
    const source = packageUninstallSource(item);
    if (busy || !source) return;
    setBusy({ kind: 'uninstall', source });
    try {
      const response = await runtimeFetch('/api/pi/extensions/uninstall', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ source }),
      });
      const raw = await response.json().catch(() => null);
      if (!response.ok) {
        if (response.status === 409) {
          toast.error(t('settings.extensions.page.packages.toast.uninstallBusy'));
          return;
        }
        const message = raw && typeof raw === 'object' && typeof (raw as { error?: unknown }).error === 'string'
          ? (raw as { error: string }).error
          : t('settings.extensions.page.packages.toast.uninstallFailed', { name: item.name });
        toast.error(message);
        return;
      }
      applyPayload(raw);
      await refreshSessionTitleReloadLists();
      toast.success(t('settings.extensions.page.packages.toast.uninstallSuccess', { name: item.name }));
    } catch {
      toast.error(t('settings.extensions.page.packages.toast.uninstallFailed', { name: item.name }));
    } finally {
      setBusy(null);
      setPendingUninstall(null);
    }
  }, [applyPayload, busy, t]);

  const showExtensionsSection = shouldShowExtensionsSection({
    loading,
    extensionCount: extensions.length,
    packageCount: packages.length,
  });
  const updates = packagesWithUpdates(packages);
  const isBusy = busy !== null;

  return (
    <SettingsPageLayout
      title={t('settings.page.extensions.title')}
      description={t('settings.page.extensions.description')}
      showSaveStatus={false}
    >
      {showExtensionsSection ? (
        <SettingsSection
          title={t('settings.extensions.page.extensions.title')}
          info={t('settings.extensions.page.extensions.info')}
          settingsItem="extensions.list"
        >
          {loading ? (
            <p className="typography-ui text-muted-foreground">{t('settings.extensions.page.loading')}</p>
          ) : extensions.length === 0 ? (
            <p className="typography-ui text-muted-foreground">{t('settings.extensions.page.extensions.empty')}</p>
          ) : (
            <ul className="space-y-2">
              {extensions.map((item) => (
                <li key={`${item.scope}:${item.path}`} className="rounded-lg border border-border/50 px-3 py-2">
                  <div className="typography-ui-label font-medium">{item.name}</div>
                  <div className="typography-meta text-muted-foreground">{item.scope} · {item.path}</div>
                </li>
              ))}
            </ul>
          )}
        </SettingsSection>
      ) : null}
      <SettingsSection
        title={t('settings.extensions.page.packages.title')}
        info={t('settings.extensions.page.packages.info')}
        settingsItem="extensions.packages"
      >
        {updates.length > 0 ? (
          <div className="mb-3 flex justify-start" data-settings-item="extensions.update-all">
            <Button
              type="button"
              size="xs"
              variant="default"
              disabled={isBusy}
              onClick={() => { void runUpdate(); }}
              className={`${SETTINGS_ACTION_BUTTON_CLASS} shrink-0 !font-normal`}
              aria-label={t('settings.extensions.page.packages.actions.updateAllAria')}
            >
              {busy?.kind === 'all'
                ? t('settings.extensions.page.packages.actions.updating')
                : t('settings.extensions.page.packages.actions.updateAll')}
            </Button>
          </div>
        ) : null}
        {loading ? (
          <p className="typography-ui text-muted-foreground">{t('settings.extensions.page.loading')}</p>
        ) : packages.length === 0 ? (
          <p className="typography-ui text-muted-foreground">{t('settings.extensions.page.packages.empty')}</p>
        ) : (
          <ul className="space-y-2">
            {packages.map((item) => {
              const source = packageUninstallSource(item);
              const rowBusy = (busy?.kind === 'one' || busy?.kind === 'uninstall') && busy.source === source;
              const showUpdate = packageVersionState(item) === 'update';
              const updateLabel = item.latestVersion
                ? t('settings.extensions.page.packages.actions.updateToVersion', {
                    version: item.latestVersion,
                  })
                : t('settings.extensions.page.packages.actions.updateAria', { name: item.name });
              const updateButton = (
                <Button
                  type="button"
                  size="xs"
                  variant="outline"
                  disabled={isBusy}
                  onClick={() => { void runUpdate(source); }}
                  className={`${SETTINGS_ACTION_BUTTON_CLASS} shrink-0 !font-normal`}
                  aria-label={updateLabel}
                >
                  {rowBusy && busy?.kind === 'one'
                    ? t('settings.extensions.page.packages.actions.updating')
                    : t('settings.extensions.page.packages.actions.update')}
                </Button>
              );
              return (
                <li key={`${item.scope}:${item.path}:${item.source}`} className="rounded-lg border border-border/50 px-3 py-2">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="min-w-0 truncate typography-ui-label font-medium">{item.name}</div>
                      {item.currentVersion ? (
                        <div
                          className={SETTINGS_VERSION_META_CLASS}
                          aria-label={t('settings.extensions.page.packages.currentVersion', {
                            version: item.currentVersion,
                          })}
                        >
                          {item.currentVersion}
                        </div>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {showUpdate ? (
                        item.latestVersion ? (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              {updateButton}
                            </TooltipTrigger>
                            <TooltipContent sideOffset={8}>
                              {t('settings.extensions.page.packages.actions.updateToVersion', {
                                version: item.latestVersion,
                              })}
                            </TooltipContent>
                          </Tooltip>
                        ) : updateButton
                      ) : null}
                      <Button
                        type="button"
                        size="xs"
                        variant="outline"
                        disabled={isBusy || !source}
                        onClick={() => setPendingUninstall(item)}
                        className="shrink-0 !font-normal"
                        aria-label={t('settings.extensions.page.packages.actions.uninstallAria', { name: item.name })}
                      >
                        {rowBusy && busy?.kind === 'uninstall'
                          ? t('settings.extensions.page.packages.actions.uninstalling')
                          : t('settings.extensions.page.packages.actions.uninstall')}
                      </Button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </SettingsSection>
      <Dialog
        open={pendingUninstall !== null}
        onOpenChange={(open) => {
          if (!open && busy?.kind !== 'uninstall') setPendingUninstall(null);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {t('settings.extensions.page.packages.dialog.uninstall.title', {
                name: pendingUninstall ? packageDisplayName(pendingUninstall) : '',
              })}
            </DialogTitle>
            <DialogDescription>
              {t('settings.extensions.page.packages.dialog.uninstall.description', {
                name: pendingUninstall ? packageDisplayName(pendingUninstall) : '',
              })}
            </DialogDescription>
            {pendingUninstall && packageUninstallSource(pendingUninstall) ? (
              <p className="typography-meta font-mono text-muted-foreground">
                {packageUninstallSource(pendingUninstall)}
              </p>
            ) : null}
          </DialogHeader>
          <DialogFooter>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setPendingUninstall(null)}
              disabled={busy?.kind === 'uninstall'}
            >
              {t('settings.common.actions.cancel')}
            </Button>
            <Button
              size="sm"
              variant="destructive"
              onClick={() => {
                if (pendingUninstall) void runUninstall(pendingUninstall);
              }}
              disabled={busy?.kind === 'uninstall' || pendingUninstall == null}
            >
              {t('settings.extensions.page.packages.actions.uninstall')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SettingsPageLayout>
  );
};
