import React from 'react';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/icon/Icon';
import { useI18n } from '@/lib/i18n';
import { openExternalUrl } from '@/lib/url';

/**
 * Moonshot China Completions API-key helper for domestic preference.
 * Not a login CTA — Code subscription sign-in remains ProviderOAuthMethods
 * (Sign in with Kimi Code). See #644 / #645.
 */
export const KIMI_DOMESTIC_API_KEY_URL = 'https://platform.moonshot.cn/console/api-keys';

export const ProviderKimiDomesticLogin: React.FC = () => {
  const { t } = useI18n();

  return (
    <div className="rounded-md border border-[var(--surface-subtle)] bg-[var(--surface-elevated)] px-3 py-2.5 space-y-2">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="typography-ui-label text-foreground">
            {t('settings.providers.page.auth.kimiDomestic.title')}
          </div>
          <p className="typography-meta mt-0.5 text-muted-foreground">
            {t('settings.providers.page.auth.kimiDomestic.description')}
          </p>
        </div>
        <Button
          variant="outline"
          size="xs"
          className="!font-normal shrink-0"
          onClick={() => void openExternalUrl(KIMI_DOMESTIC_API_KEY_URL)}
        >
          <Icon name="external-link" className="mr-1.5 h-3.5 w-3.5" />
          {t('settings.providers.page.auth.kimiDomestic.getApiKey')}
        </Button>
      </div>
      <p className="typography-meta text-muted-foreground">
        {t('settings.providers.page.auth.kimiDomestic.hint')}
      </p>
    </div>
  );
};
