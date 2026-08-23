import React from 'react';
import { SettingsPageLayout } from '@/components/sections/shared/SettingsPageLayout';
import { SettingsSection } from '@/components/sections/shared/SettingsSection';
import { shouldShowExtensionsSection } from './extensionsPageVisibility';
import { useI18n } from '@/lib/i18n';
import { runtimeFetch } from '@/lib/runtime-fetch';

type ExtensionItem = { name: string; path: string; scope: string };
type PackageItem = { name: string; path: string; scope: string; source: string };

export const ExtensionsPage: React.FC = () => {
  const { t } = useI18n();
  const [extensions, setExtensions] = React.useState<ExtensionItem[]>([]);
  const [packages, setPackages] = React.useState<PackageItem[]>([]);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const response = await runtimeFetch('/api/pi/extensions', { headers: { Accept: 'application/json' } });
        if (!response.ok) return;
        const data = await response.json() as { extensions?: ExtensionItem[]; packages?: PackageItem[] };
        if (cancelled) return;
        setExtensions(Array.isArray(data.extensions) ? data.extensions : []);
        setPackages(Array.isArray(data.packages) ? data.packages : []);
      } catch {
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => { cancelled = true; };
  }, []);

  const showExtensionsSection = shouldShowExtensionsSection({
    loading,
    extensionCount: extensions.length,
    packageCount: packages.length,
  });

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
        {loading ? (
          <p className="typography-ui text-muted-foreground">{t('settings.extensions.page.loading')}</p>
        ) : packages.length === 0 ? (
          <p className="typography-ui text-muted-foreground">{t('settings.extensions.page.packages.empty')}</p>
        ) : (
          <ul className="space-y-2">
            {packages.map((item) => (
              <li key={`${item.scope}:${item.source}:${item.path}`} className="rounded-lg border border-border/50 px-3 py-2">
                <div className="typography-ui-label font-medium">{item.name}</div>
                <div className="typography-meta text-muted-foreground">{item.scope} · {item.source} · {item.path}</div>
              </li>
            ))}
          </ul>
        )}
      </SettingsSection>
    </SettingsPageLayout>
  );
};
