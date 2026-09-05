import React from 'react';
import { ScrollableOverlay } from '@/components/ui/ScrollableOverlay';
import { SettingsPageLayout } from '@/components/sections/shared/SettingsPageLayout';
import { SettingsSection, SettingsFieldRow, SettingsChipGroup, SETTINGS_CUSTOM_TRIGGER_CLASS } from '@/components/sections/shared/SettingsSection';
import { SettingsInfoHint } from '@/components/sections/shared/SettingsInfoHint';
import { ProviderLogo } from '@/components/ui/ProviderLogo';
import { selectProvidersForDirectory, useConfigStore } from '@/stores/useConfigStore';
import { useSettingsDirectory } from '@/hooks/useSettingsDirectory';
import { useUIStore } from '@/stores/useUIStore';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { toast } from '@/components/ui';
import { Icon } from "@/components/icon/Icon";
import type { IconName } from "@/components/icon/icons";
import { noteDeferredRestartFromPayload, recordDeferredOpenCodeRestart } from '@/lib/opencode/deferredRestart';
import { cn } from '@/lib/utils';
import type { ModelMetadata } from '@/types';
import { getCurrentIntlLocale, useI18n } from '@/lib/i18n';
import { runtimeFetch } from '@/lib/runtime-fetch';
import { opencodeClient } from '@/lib/opencode/client';
import { usePiKernel } from '@/lib/usePiKernel';
import { reportSettingsSaveState } from '@/lib/persistence';
import {
  familyIsConnected,
  isKimiSubscriptionId,
  isOfficialSubscriptionId,
  isXaiSubscriptionId,
  subscriptionFamilyOf,
} from '@/lib/pi/subscription-clones';
import { useFeaturePluginSlotActive } from '@/stores/useFeaturePluginSlotsStore';
import { useResolvedPiAgentDir } from '@/lib/useResolvedPiAgentDir';
import {
  parseConnectedProviderIds,
  providerHasConnectedModels,
  requiresProviderAuth,
  selectAddCatalogProviders,
  selectSidebarProviders,
  shouldAutoSelectBuiltinAddProvider,
  shouldAutoSelectCustomProvider,
  shouldLoadAvailableProviders,
} from './providerAvailability';
import {
  dualAuthCatalogId,
  dualAuthSiblingId,
  getOAuthAuthMethods,
  isDualAuthApiSiblingId,
  isDualAuthCatalogId,
  isDualAuthSurfaceId,
  parseAuthPayload,
  providerHasCredentials,
  requiresOpenCodeRestartAfterOAuth,
  shouldAutoOpenAuthPanel,
  shouldShowApiKeyAuth,
  shouldShowModelsSection,
  type AuthMethod,
  type OAuthAuthMethodEntry,
} from './providerAuth';
import { matchesRankQuery, rankByQuery } from '@/lib/search/fuzzySearch';
import { CustomProviderForm } from './CustomProviderForm';
import { ProviderOAuthMethods, type ProviderOAuthMethod } from './ProviderOAuthMethods';
import { ProviderXaiUsage } from './ProviderXaiUsage';
import { ProviderKimiUsage } from './ProviderKimiUsage';
import {
  buildAuthSetRequest,
  buildProviderUpsertRequest,
  CUSTOM_PROVIDER_ID,
  isConfigDefinedCustomProvider,
  providerToCustomFormState,
  fetchRemoteModelsErrorKey,
  resolveProviderConfigScope,
  type CustomProviderFormState,
  type CustomProviderPersistPlan,
  type ProviderConfigScope,
} from './custom-provider-form';

const providerDeclaresEnv = (provider: { env?: string[] } | undefined): boolean =>
  Array.isArray(provider?.env) && provider.env.some((name) => name.trim().length > 0);

const formatCompactNumber = (value: number) => new Intl.NumberFormat(getCurrentIntlLocale(), {
  notation: 'compact',
  compactDisplay: 'short',
  maximumFractionDigits: 1,
  minimumFractionDigits: 0,
}).format(value);

const formatTokens = (value?: number | null) => {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return null;
  }
  if (value === 0) {
    return '0';
  }
  const formatted = formatCompactNumber(value);
  return formatted.endsWith('.0') ? formatted.slice(0, -2) : formatted;
};

const ADD_PROVIDER_ID = '__add_provider__';

interface ProviderOption {
  id: string;
  name?: string;
}

interface ProviderSourceInfo {
  exists: boolean;
  path?: string | null;
}

interface ProviderSources {
  auth: ProviderSourceInfo;
  user: ProviderSourceInfo;
  project: ProviderSourceInfo;
  custom?: ProviderSourceInfo;
  oauth?: ProviderSourceInfo;
  apiKey?: ProviderSourceInfo;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const toOAuthMethods = (
  entries: OAuthAuthMethodEntry[],
  fallbackLabel: (index: number) => string,
): ProviderOAuthMethod[] =>
  entries.map(({ method, methodIndex }) => ({
    index: methodIndex,
    label: method.label || method.name || fallbackLabel(methodIndex),
    prompts: method.prompts,
  }));

const normalizeProviderEntry = (entry: unknown): ProviderOption | null => {
  if (typeof entry === 'string') {
    return { id: entry };
  }
  if (!isRecord(entry)) {
    return null;
  }
  const idCandidate =
    (typeof entry.id === 'string' && entry.id) ||
    (typeof entry.providerID === 'string' && entry.providerID) ||
    (typeof entry.slug === 'string' && entry.slug) ||
    (typeof entry.name === 'string' && entry.name);
  if (!idCandidate) {
    return null;
  }
  const nameCandidate = typeof entry.name === 'string' ? entry.name : undefined;
  return { id: idCandidate, name: nameCandidate };
};

const parseProvidersPayload = (payload: unknown): ProviderOption[] => {
  let entries: unknown[] = [];

  if (Array.isArray(payload)) {
    entries = payload;
  } else if (isRecord(payload)) {
    if (Array.isArray(payload.all)) {
      entries = payload.all;
    } else if (Array.isArray(payload.providers)) {
      entries = payload.providers;
    }
  }

  const mapped = entries
    .map((entry) => normalizeProviderEntry(entry))
    .filter((entry): entry is ProviderOption => Boolean(entry));

  const seen = new Set<string>();
  return mapped.filter((entry) => {
    if (seen.has(entry.id)) {
      return false;
    }
    seen.add(entry.id);
    return true;
  });
};

export const ProvidersPage: React.FC = () => {
  const { t } = useI18n();
  const isPiKernel = usePiKernel();
  const xaiSlotActive = useFeaturePluginSlotActive('xai', isPiKernel);
  const kimiSlotActive = useFeaturePluginSlotActive('kimi', isPiKernel);
  const piAgentDir = useResolvedPiAgentDir();
  // Settings browses whichever project its own selector points at; the app
  // stays where it is.
  const settingsDirectory = useSettingsDirectory();
  const providers = selectSidebarProviders(
    useConfigStore((state) => selectProvidersForDirectory(state, settingsDirectory)),
  );
  const selectedProviderId = useConfigStore((state) => state.selectedProviderId);
  const setSelectedProvider = useConfigStore((state) => state.setSelectedProvider);
  const loadProviders = useConfigStore((state) => state.loadProviders);
  const getModelMetadata = useConfigStore((state) => state.getModelMetadata);
  const hiddenModels = useUIStore((state) => state.hiddenModels);
  const toggleHiddenModel = useUIStore((state) => state.toggleHiddenModel);
  const hideAllModels = useUIStore((state) => state.hideAllModels);
  const showAllModels = useUIStore((state) => state.showAllModels);

  const [authMethodsByProvider, setAuthMethodsByProvider] = React.useState<Record<string, AuthMethod[]>>({});
  const [authLoading, setAuthLoading] = React.useState(false);
  const [apiKeyInputs, setApiKeyInputs] = React.useState<Record<string, string>>({});
  const [displayNameInputs, setDisplayNameInputs] = React.useState<Record<string, string>>({});
  const [regionByProvider, setRegionByProvider] = React.useState<Record<string, 'international' | 'domestic'>>({});
  const [authBusyKey, setAuthBusyKey] = React.useState<string | null>(null);
  const [modelQuery, setModelQuery] = React.useState('');
  const [availableProviders, setAvailableProviders] = React.useState<ProviderOption[]>([]);
  const [availableConnectedIds, setAvailableConnectedIds] = React.useState<string[]>([]);
  const [availableLoading, setAvailableLoading] = React.useState(false);
  const [availableError, setAvailableError] = React.useState<string | null>(null);
  const [candidateProviderId, setCandidateProviderId] = React.useState('');
  const [providerSearchQuery, setProviderSearchQuery] = React.useState('');
  const [providerDropdownOpen, setProviderDropdownOpen] = React.useState(false);
  const [providerSources, setProviderSources] = React.useState<Record<string, ProviderSources>>({});
  const [providerSourceEpoch, setProviderSourceEpoch] = React.useState(0);
  const [showAuthPanel, setShowAuthPanel] = React.useState(false);
  const [authPanelDismissedForId, setAuthPanelDismissedForId] = React.useState<string | null>(null);
  const [editingCustomProviderId, setEditingCustomProviderId] = React.useState<string | null>(null);
  const [editingCustomFormInitial, setEditingCustomFormInitial] = React.useState<CustomProviderFormState | null>(null);
  const [editingCustomScope, setEditingCustomScope] = React.useState<ProviderConfigScope | null>(null);
  const [customAuthFailureHint, setCustomAuthFailureHint] = React.useState<string | null>(null);
  const [lastCustomPersistId, setLastCustomPersistId] = React.useState<string | null>(null);
  const [customModelsSyncBusy, setCustomModelsSyncBusy] = React.useState(false);
  const customModelsSyncedForRef = React.useRef<string | null>(null);
  const isAddMode = selectedProviderId === ADD_PROVIDER_ID;
  const isCustomCreateMode = isAddMode && candidateProviderId === CUSTOM_PROVIDER_ID;
  const isCustomEditMode = Boolean(
    editingCustomProviderId
    && selectedProviderId
    && editingCustomProviderId === selectedProviderId
    && !isAddMode,
  );

  React.useEffect(() => {
    if (!selectedProviderId && providers.length > 0) {
      setSelectedProvider(providers[0].id);
    }
  }, [providers, selectedProviderId, setSelectedProvider]);

  React.useEffect(() => {
    // Auth methods drive which credential UI to show (API key vs OAuth). Keep
    // them loaded for the active provider view so OAuth-only plugins never fall
    // back to an API key form merely because methods were never fetched, and so
    // an already-listed provider can still offer re-authentication.
    if (!selectedProviderId) {
      return;
    }

    let isMounted = true;

    const loadAuthMethods = async () => {
      setAuthLoading(true);
      try {
        const result = await opencodeClient.getSdkClient().provider.auth();
        if (result.error) {
          throw new Error(`provider.auth failed: ${String(result.error)}`);
        }
        if (!isMounted) return;
        setAuthMethodsByProvider(parseAuthPayload(result.data));
      } catch (error) {
        if (!isMounted) return;
        console.error('Failed to load provider auth methods:', error);
        toast.error(t('settings.providers.page.toast.authMethodsLoadFailed'));
      } finally {
        if (isMounted) {
          setAuthLoading(false);
        }
      }
    };

    loadAuthMethods();

    return () => {
      isMounted = false;
    };
  }, [selectedProviderId, t]);

  React.useEffect(() => {
    if (!shouldLoadAvailableProviders(isAddMode)) {
      return;
    }

    let isMounted = true;

    const loadAvailableProviders = async () => {
      setAvailableLoading(true);
      setAvailableError(null);
      try {
        const result = await opencodeClient.getSdkClient().provider.list();
        if (result.error) {
          throw new Error(`provider.list failed: ${String(result.error)}`);
        }
        if (!isMounted) return;
        setAvailableProviders(parseProvidersPayload(result.data));
        setAvailableConnectedIds(parseConnectedProviderIds(result.data));
      } catch (error) {
        if (!isMounted) return;
        console.error('Failed to load available providers:', error);
        const message = t('settings.providers.page.toast.catalogLoadFailed');
        setAvailableError(message);
        toast.error(message);
      } finally {
        if (isMounted) {
          setAvailableLoading(false);
        }
      }
    };

    loadAvailableProviders();

    return () => {
      isMounted = false;
    };
  }, [isAddMode, t]);

  const connectedProviderIds = React.useMemo(() => {
    const ids = new Set(
      providers.filter((provider) => providerHasConnectedModels(provider)).map((provider) => provider.id),
    );
    for (const id of availableConnectedIds) {
      ids.add(id);
    }
    return ids;
  }, [availableConnectedIds, providers]);

  const addCatalogProviders = React.useMemo(
    () => selectAddCatalogProviders(availableProviders, connectedProviderIds),
    [availableProviders, connectedProviderIds]
  );

  React.useEffect(() => {
    if (selectedProviderId !== ADD_PROVIDER_ID) {
      return;
    }

    if (
      candidateProviderId
      && candidateProviderId !== CUSTOM_PROVIDER_ID
      && !addCatalogProviders.some((provider) => provider.id === candidateProviderId)
    ) {
      setCandidateProviderId('');
    }
  }, [selectedProviderId, candidateProviderId, addCatalogProviders]);

  const catalogAutoSelectedRef = React.useRef(false);
  React.useEffect(() => {
    if (!isAddMode) {
      catalogAutoSelectedRef.current = false;
      return;
    }
    if (catalogAutoSelectedRef.current) {
      return;
    }
    const builtinId = shouldAutoSelectBuiltinAddProvider(
      isAddMode,
      availableLoading,
      addCatalogProviders,
      candidateProviderId,
      'xai',
      Boolean(availableError),
    );
    if (builtinId && !familyIsConnected('xai', connectedProviderIds)) {
      catalogAutoSelectedRef.current = true;
      setCandidateProviderId(builtinId);
      return;
    }
    if (shouldAutoSelectCustomProvider(
      isAddMode,
      availableLoading,
      addCatalogProviders.length,
      candidateProviderId,
      Boolean(availableError),
    )) {
      catalogAutoSelectedRef.current = true;
      setCandidateProviderId(CUSTOM_PROVIDER_ID);
    }
  }, [addCatalogProviders, availableError, availableLoading, candidateProviderId, connectedProviderIds, isAddMode]);

  React.useEffect(() => {
    if (selectedProviderId === ADD_PROVIDER_ID) {
      setShowAuthPanel(true);
      setAuthPanelDismissedForId(null);
      setEditingCustomProviderId(null);
      setEditingCustomFormInitial(null);
      setEditingCustomScope(null);
      setCustomAuthFailureHint(null);
      return;
    }

    setShowAuthPanel(false);
    setAuthPanelDismissedForId(null);
    if (editingCustomProviderId && editingCustomProviderId !== selectedProviderId) {
      setEditingCustomProviderId(null);
      setEditingCustomFormInitial(null);
      setEditingCustomScope(null);
      setCustomAuthFailureHint(null);
    }
  }, [selectedProviderId, editingCustomProviderId]);

  // Unauthenticated providers (OAuth-only plugins before login) should open the
  // auth panel instead of a false "Connected" summary. Respect an explicit Hide.
  React.useEffect(() => {
    if (!selectedProviderId || selectedProviderId === ADD_PROVIDER_ID) {
      return;
    }
    const sources = providerSources[selectedProviderId];
    if (!sources) {
      return;
    }
    const provider = providers.find((entry) => entry.id === selectedProviderId);
    const hasCreds = providerHasCredentials({
      key: (provider as { key?: string | null } | undefined)?.key,
      authSourceExists: sources.auth.exists,
      optionsApiKey: (provider as { options?: { apiKey?: string | null } } | undefined)?.options?.apiKey ?? null,
      envDeclared: providerDeclaresEnv(provider),
    });
    const isEditableCustomProvider = Boolean(
      provider && isConfigDefinedCustomProvider(provider, sources),
    );
    const dualAuthIncomplete = isDualAuthSurfaceId(selectedProviderId)
      && !(sources.oauth?.exists === true && sources.apiKey?.exists === true);
    if (
      shouldAutoOpenAuthPanel({
        sourcesLoaded: true,
        hasCredentials: hasCreds,
        userDismissed: authPanelDismissedForId === selectedProviderId,
        isEditableCustomProvider,
        dualAuthIncomplete,
      })
    ) {
      setShowAuthPanel(true);
    }
  }, [selectedProviderId, providerSources, providers, authPanelDismissedForId]);

  React.useEffect(() => {
    if (!selectedProviderId || selectedProviderId === ADD_PROVIDER_ID) {
      return;
    }

    let cancelled = false;

    const loadSources = async () => {
      try {
        // OpenChamber-only metadata endpoint: the SDK exposes provider data but
        // not local auth/source-file provenance used by this settings UI.
        const query = settingsDirectory ? `?directory=${encodeURIComponent(settingsDirectory)}` : '';
        const response = await runtimeFetch(`/api/provider/${encodeURIComponent(selectedProviderId)}/source${query}`, {
          method: 'GET',
          headers: { Accept: 'application/json' },
        });

        const payload = await response.json().catch(() => null);
        if (!response.ok) {
          throw new Error(payload?.error || t('settings.providers.page.toast.providerSourcesLoadFailed'));
        }

        const sources = (payload?.sources ?? payload?.data?.sources) as ProviderSources | undefined;
        if (!cancelled && sources) {
          setProviderSources((prev) => ({
            ...prev,
            [selectedProviderId]: sources,
          }));
        }
      } catch (error) {
        if (!cancelled) {
          console.error('Failed to load provider sources:', error);
        }
      }
    };

    loadSources();

    return () => {
      cancelled = true;
    };
  }, [selectedProviderId, settingsDirectory, t, providerSourceEpoch]);

  const syncCustomProviderModels = React.useCallback(async (
    providerId: string,
    options?: { scope?: ProviderConfigScope; silent?: boolean },
  ) => {
    if (!providerId || customModelsSyncBusy) {
      return false;
    }
    setCustomModelsSyncBusy(true);
    try {
      const params = new URLSearchParams();
      if (settingsDirectory) {
        params.set('directory', settingsDirectory);
      }
      if (options?.scope) {
        params.set('scope', options.scope);
      }
      const query = params.toString() ? `?${params.toString()}` : '';
      const response = await runtimeFetch(
        `/api/provider/${encodeURIComponent(providerId)}/sync-models${query}`,
        {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(options?.scope ? { scope: options.scope } : {}),
        },
      );
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        if (!options?.silent) {
          const key = fetchRemoteModelsErrorKey(
            response.status,
            typeof payload?.error === 'string' ? payload.error : undefined,
          );
          toast.error(t(key as Parameters<typeof t>[0]));
        }
        return false;
      }
      if (payload?.reason === 'empty' && !options?.silent) {
        toast.error(t('settings.providers.page.custom.toast.modelsEmpty'));
        return false;
      }
      await loadProviders({ directory: settingsDirectory, source: 'settings:custom-provider-models-sync' });
      if (!options?.silent && typeof payload?.added === 'number' && payload.added > 0) {
        toast.success(t('settings.providers.page.custom.toast.modelsSynced', { count: String(payload.added) }));
      }
      return true;
    } catch (error) {
      console.error('Failed to sync custom provider models:', error);
      if (!options?.silent) {
        toast.error(t('settings.providers.page.custom.error.fetch.failed'));
      }
      return false;
    } finally {
      setCustomModelsSyncBusy(false);
    }
  }, [customModelsSyncBusy, loadProviders, settingsDirectory, t]);

  React.useEffect(() => {
    if (!selectedProviderId || selectedProviderId === ADD_PROVIDER_ID) {
      return;
    }
    const sources = providerSources[selectedProviderId];
    if (!sources) {
      return;
    }
    const provider = providers.find((entry) => entry.id === selectedProviderId);
    if (!provider || !isConfigDefinedCustomProvider(provider, sources)) {
      return;
    }
    const hasAuth = sources.auth?.exists === true;
    const hasEnv = Array.isArray(provider.env) && provider.env.some((name) => typeof name === 'string' && name.trim().length > 0);
    if (!hasAuth && !hasEnv) {
      return;
    }
    if (customModelsSyncedForRef.current === selectedProviderId) {
      return;
    }
    customModelsSyncedForRef.current = selectedProviderId;
    void syncCustomProviderModels(selectedProviderId, {
      scope: resolveProviderConfigScope(sources),
      silent: true,
    });
  }, [selectedProviderId, providerSources, providers, syncCustomProviderModels]);

  const selectedProvider = providers.find((provider) => provider.id === selectedProviderId);
  const selectedSources = selectedProviderId ? providerSources[selectedProviderId] : undefined;

  const ensureAnotherSubscription = async (family: 'xai' | 'kimi-coding') => {
    if (!isPiKernel || !familyIsConnected(family, connectedProviderIds)) {
      setCandidateProviderId(family);
      return;
    }
    const displayName = displayNameInputs[family]?.trim();
    const region = family === 'kimi-coding' ? (regionByProvider[family] || 'international') : undefined;
    try {
      const response = await runtimeFetch('/api/pi/subscription-clones', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          family,
          ...(displayName ? { displayName } : {}),
          ...(region ? { region } : {}),
        }),
      });
      const payload = await response.json().catch(() => null) as { providerId?: string } | null;
      if (!response.ok || typeof payload?.providerId !== 'string') {
        toast.error(t('settings.providers.page.subscription.clone.failed'));
        return;
      }
      await loadProviders({ directory: settingsDirectory, source: 'settings:subscription-clone' });
      setCandidateProviderId(payload.providerId);
    } catch {
      toast.error(t('settings.providers.page.subscription.clone.failed'));
    }
  };

  const handleSaveDisplayName = async (providerId: string) => {
    const displayName = displayNameInputs[providerId]?.trim();
    if (!displayName) return;
    reportSettingsSaveState('saving');
    try {
      const response = await runtimeFetch(`/api/pi/subscription-clones/${encodeURIComponent(providerId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ displayName }),
      });
      if (!response.ok) {
        reportSettingsSaveState('error');
        toast.error(t('settings.providers.page.subscription.displayName.failed'));
        return;
      }
      reportSettingsSaveState('saved');
      await loadProviders({ directory: settingsDirectory, source: 'settings:subscription-name' });
    } catch {
      reportSettingsSaveState('error');
      toast.error(t('settings.providers.page.subscription.displayName.failed'));
    }
  };

  const refreshKimiRegions = React.useCallback(async () => {
    if (!isPiKernel) return;
    try {
      const response = await runtimeFetch('/api/pi/kimi-region', { headers: { Accept: 'application/json' } });
      const payload = await response.json().catch(() => null) as {
        rows?: Array<{ providerId?: string; region?: string }>;
      } | null;
      if (!Array.isArray(payload?.rows)) return;
      const next: Record<string, 'international' | 'domestic'> = {};
      for (const row of payload.rows) {
        if (typeof row?.providerId !== 'string' || !row.providerId) continue;
        next[row.providerId] = row.region === 'domestic' ? 'domestic' : 'international';
      }
      setRegionByProvider((prev) => ({ ...prev, ...next }));
    } catch {
      // Region chips stay on last known / default international.
    }
  }, [isPiKernel]);

  React.useEffect(() => {
    void refreshKimiRegions();
  }, [refreshKimiRegions, providers]);

  const handleSaveRegion = async (providerId: string, region: 'international' | 'domestic') => {
    setRegionByProvider((prev) => ({ ...prev, [providerId]: region }));
    reportSettingsSaveState('saving');
    try {
      const response = await runtimeFetch('/api/pi/kimi-region', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ providerId, region }),
      });
      if (!response.ok) {
        reportSettingsSaveState('error');
        toast.error(t('settings.providers.page.subscription.region.failed'));
        await refreshKimiRegions();
        return;
      }
      reportSettingsSaveState('saved');
      await loadProviders({ directory: settingsDirectory, source: 'settings:subscription-region' });
      await refreshKimiRegions();
    } catch {
      reportSettingsSaveState('error');
      toast.error(t('settings.providers.page.subscription.region.failed'));
      await refreshKimiRegions();
    }
  };

  const handleSaveApiKey = async (providerId: string) => {
    const apiKey = apiKeyInputs[providerId]?.trim() ?? '';
    if (!apiKey) {
      toast.error(t('settings.providers.page.toast.apiKeyRequired'));
      return;
    }

    const busyKey = `api:${providerId}`;
    setAuthBusyKey(busyKey);

    try {
      const result = await opencodeClient.getSdkClient().auth.set({
        providerID: providerId,
        auth: { type: 'api', key: apiKey },
      });
      if (result.error) {
        throw new Error(t('settings.providers.page.toast.apiKeySaveFailed'));
      }

      toast.success(t('settings.providers.page.toast.apiKeySaved'));
      setApiKeyInputs((prev) => ({ ...prev, [providerId]: '' }));
      if (!isPiKernel) {
        recordDeferredOpenCodeRestart('providers', { id: providerId });
      }
      await loadProviders({ directory: settingsDirectory, source: 'settings:api-key-save' });
      const siblingId = dualAuthSiblingId(providerId);
      setSelectedProvider(siblingId && isDualAuthCatalogId(providerId) ? siblingId : providerId);
      setProviderSourceEpoch((n) => n + 1);
    } catch (error) {
      console.error('Failed to save API key:', error);
      toast.error(t('settings.providers.page.toast.apiKeySaveFailed'));
    } finally {
      setAuthBusyKey(null);
    }
  };

  const handleSaveCustomProvider = async (plan: CustomProviderPersistPlan) => {
    const busyKey = `custom:${plan.providerID}`;
    setAuthBusyKey(busyKey);
    setLastCustomPersistId(plan.providerID);
    setCustomAuthFailureHint(null);

    try {
      // Auth first so a failed key write cannot leave an orphan config that
      // blocks create validation, and so PUT can pass hasStoredAuth for literal keys.
      const authRequest = buildAuthSetRequest(plan);
      if (authRequest) {
        const authResult = await opencodeClient.getSdkClient().auth.set(authRequest);
        if (authResult.error) {
          throw new Error(t('settings.providers.page.toast.apiKeySaveFailed'));
        }
      }

      const upsertBody = buildProviderUpsertRequest(plan, {
        // Create defaults to user. Edit must rewrite the winning config layer
        // (custom > project > user) so project/custom providers are not copied
        // into a global user override.
        scope: editingCustomProviderId
          ? (editingCustomScope ?? resolveProviderConfigScope(providerSources[editingCustomProviderId]))
          : 'user',
      });
      const response = await runtimeFetch(`/api/provider${settingsDirectory ? `?directory=${encodeURIComponent(settingsDirectory)}` : ''}`, {
        method: 'PUT',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(upsertBody),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        if (authRequest) {
          setCustomAuthFailureHint(t('settings.providers.page.custom.authFailure.configAfterAuth'));
        }
        throw new Error(payload?.error || t('settings.providers.page.toast.customProviderSaveFailed'));
      }

      toast.success(t('settings.providers.page.toast.customProviderSaved', { provider: plan.name }));
      if (payload?.modelsSync && payload.modelsSync.ok === false) {
        const key = fetchRemoteModelsErrorKey(
          502,
          typeof payload.modelsSync.error === 'string' ? payload.modelsSync.error : undefined,
        );
        toast.error(t(key as Parameters<typeof t>[0]));
      } else if (payload?.modelsSync?.reason === 'empty') {
        toast.error(t('settings.providers.page.custom.toast.modelsEmpty'));
      }
      customModelsSyncedForRef.current = plan.providerID;
      await loadProviders({ directory: settingsDirectory, source: 'settings:custom-provider-save' });
      setCandidateProviderId('');
      setEditingCustomProviderId(null);
      setEditingCustomFormInitial(null);
      setEditingCustomScope(null);
      setCustomAuthFailureHint(null);
      setLastCustomPersistId(null);
      noteDeferredRestartFromPayload(payload, 'providers', { id: plan.providerID });
      setSelectedProvider(plan.providerID);
    } catch (error) {
      console.error('Failed to save custom provider:', error);
      toast.error(
        error instanceof Error && error.message
          ? error.message
          : t('settings.providers.page.toast.customProviderSaveFailed'),
      );
    } finally {
      setAuthBusyKey(null);
    }
  };

  const oauthMethodFallbackLabel = (index: number) =>
    t('settings.providers.page.auth.oauthMethodFallback', { index: String(index + 1) });

  const handleOAuthConnected = async (providerId: string) => {
    setAuthPanelDismissedForId(null);
    if (!isDualAuthSurfaceId(providerId)) {
      setShowAuthPanel(false);
    }
    if (!isPiKernel && requiresOpenCodeRestartAfterOAuth(providerId)) {
      recordDeferredOpenCodeRestart('providers', { id: providerId });
    }
    const region = isKimiSubscriptionId(providerId) ? regionByProvider[providerId] : undefined;
    if (region === 'domestic' || region === 'international') {
      await handleSaveRegion(providerId, region);
    }
    await loadProviders({ directory: settingsDirectory, source: 'settings:oauth-connected' });
    setSelectedProvider(dualAuthCatalogId(providerId) ?? providerId);
    setProviderSourceEpoch((n) => n + 1);
  };

  const handleDisconnectProvider = async (providerId: string) => {
    const busyKey = `disconnect:${providerId}`;
    setAuthBusyKey(busyKey);

    try {
      const response = await runtimeFetch(
        `/api/provider/${encodeURIComponent(providerId)}/auth?scope=all${settingsDirectory ? `&directory=${encodeURIComponent(settingsDirectory)}` : ''}`,
        {
          method: 'DELETE',
          headers: { Accept: 'application/json' },
        },
      );

      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error || t('settings.providers.page.toast.providerDisconnectFailed'));
      }

      toast.success(t('settings.providers.page.toast.providerDisconnected'));
      // Only accumulate when the server actually deferred a restart (e.g. auth removed).
      // removed:false payloads must not create a phantom pending Apply & Restart.
      noteDeferredRestartFromPayload(payload, 'providers', { id: providerId });
      await loadProviders({ directory: settingsDirectory, source: 'settings:provider-disconnect' });
      setProviderSourceEpoch((n) => n + 1);
    } catch (error) {
      console.error('Failed to disconnect provider:', error);
      toast.error(t('settings.providers.page.toast.providerDisconnectFailed'));
    } finally {
      setAuthBusyKey(null);
    }
  };

  const handleDisconnectCustomProvider = async (providerId: string) => {
    if (!providerId) {
      return;
    }
    await handleDisconnectProvider(providerId);
    setEditingCustomProviderId(null);
    setEditingCustomFormInitial(null);
    setEditingCustomScope(null);
    setCustomAuthFailureHint(null);
    setLastCustomPersistId(null);
    setCandidateProviderId('');
  };

  if (!isAddMode && providers.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center text-muted-foreground">
          <Icon name="stack" className="mx-auto mb-3 h-12 w-12 opacity-50" />
          <p className="typography-body">{t('settings.providers.page.empty.noProvidersDetected')}</p>
          <p className="typography-meta mt-1 opacity-75">{t('settings.providers.page.empty.checkOpenCodeConfiguration', { path: piAgentDir })}</p>
        </div>
      </div>
    );
  }

  if (isAddMode) {
    return (
      <SettingsPageLayout
        title={t('settings.providers.page.connect.title')}
        showSaveStatus={false}
      >
        <SettingsSection
          title={t('settings.providers.page.connect.selectProviderTitle')}
          divider={false}
          settingsItem="providers.connect"
        >
              <div className="flex flex-wrap items-center gap-2 py-1.5">
                <span className="typography-ui-label text-foreground">{t('settings.providers.page.connect.providerField')}</span>
                  {availableLoading ? (
                    <p className="typography-meta text-muted-foreground">{t('settings.providers.page.state.loading')}</p>
                  ) : (
                    <>
                    {availableError ? (
                      <p className="typography-meta text-[var(--status-error)]">{availableError}</p>
                    ) : null}
                    <DropdownMenu open={providerDropdownOpen} onOpenChange={(open) => {
                      setProviderDropdownOpen(open);
                      if (!open) setProviderSearchQuery('');
                    }}>
                      <DropdownMenuTrigger asChild>
                        <button
                          type="button"
                          className={SETTINGS_CUSTOM_TRIGGER_CLASS}
                        >
                          <span className="flex items-center gap-2 min-w-0">
                            {candidateProviderId && candidateProviderId !== CUSTOM_PROVIDER_ID ? (
                              <ProviderLogo providerId={candidateProviderId} className="h-3.5 w-3.5 flex-shrink-0" />
                            ) : null}
                            <span className={cn("truncate typography-ui-label font-normal", candidateProviderId ? "text-foreground" : "text-muted-foreground")}>
                              {candidateProviderId === CUSTOM_PROVIDER_ID
                                ? t('settings.providers.page.custom.optionLabel')
                                : candidateProviderId
                                  ? (addCatalogProviders.find(p => p.id === candidateProviderId)?.name || candidateProviderId)
                                  : t('settings.providers.page.connect.selectProviderPlaceholder')}
                            </span>
                          </span>
                          <Icon name="arrow-down-s" className="h-4 w-4 flex-shrink-0 text-muted-foreground/50" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent
                        align="start"
                        className="w-[280px] p-0"
                        onCloseAutoFocus={(e) => e.preventDefault()}
                      >
                        <div
                          className="flex items-center gap-2 border-b border-[var(--surface-subtle)] px-3 py-2"
                          onKeyDown={(e) => e.stopPropagation()}
                        >
                          <Icon name="search" className="h-4 w-4 text-muted-foreground" />
                          <input
                            type="text"
                            value={providerSearchQuery}
                            onChange={(e) => setProviderSearchQuery(e.target.value)}
                            onKeyDown={(e) => e.stopPropagation()}
                            placeholder={t('settings.providers.page.connect.searchProvidersPlaceholder')}
                            className="flex-1 bg-transparent typography-meta outline-none placeholder:text-muted-foreground"
                            autoFocus
                          />
                        </div>
                        <ScrollableOverlay outerClassName="max-h-[240px]" className="p-1">
                          {(() => {
                            const customLabel = t('settings.providers.page.custom.optionLabel');
                            const customMatches = addCatalogProviders.length === 0
                              || matchesRankQuery([customLabel, 'other', 'custom'], providerSearchQuery);
                            const filtered = rankByQuery(addCatalogProviders, providerSearchQuery, (p) => [p.name || p.id, p.id]);
                            if (filtered.length === 0 && !customMatches) {
                              return <p className="py-4 text-center typography-meta text-muted-foreground">{t('settings.providers.page.connect.noProvidersFound')}</p>;
                            }
                            return (
                              <>
                                {addCatalogProviders.length === 0 && !providerSearchQuery.trim() ? (
                                  <p className="px-2 py-2 typography-meta text-muted-foreground">
                                    {t(connectedProviderIds.size > 0
                                      ? 'settings.providers.page.connect.allCatalogConnected'
                                      : 'settings.providers.page.connect.emptyCatalog')}
                                  </p>
                                ) : null}
                                {filtered.map((provider) => (
                                  <DropdownMenuItem
                                    key={provider.id}
                                    onSelect={() => {
                                      const family = subscriptionFamilyOf(provider.id);
                                      if (isPiKernel && family && family === provider.id) {
                                        void ensureAnotherSubscription(family);
                                      } else {
                                        setCandidateProviderId(provider.id);
                                      }
                                      setProviderDropdownOpen(false);
                                      setProviderSearchQuery('');
                                    }}
                                    className="flex items-center justify-between"
                                  >
                                    <span className="flex items-center gap-2 min-w-0">
                                      <ProviderLogo providerId={provider.id} className="h-4 w-4 flex-shrink-0" />
                                      <span className="truncate">{provider.name || provider.id}</span>
                                    </span>
                                    {candidateProviderId === provider.id && (
                                      <Icon name="check" className="h-4 w-4 text-[var(--primary-base)]" />
                                    )}
                                  </DropdownMenuItem>
                                ))}
                                {customMatches ? (
                                  <DropdownMenuItem
                                    key={CUSTOM_PROVIDER_ID}
                                    onSelect={() => {
                                      setCandidateProviderId(CUSTOM_PROVIDER_ID);
                                      setProviderDropdownOpen(false);
                                      setProviderSearchQuery('');
                                    }}
                                    className="flex items-center justify-between"
                                  >
                                    <span className="flex items-center gap-2 min-w-0">
                                      <Icon name="add" className="h-4 w-4 flex-shrink-0" />
                                      <span className="truncate">{customLabel}</span>
                                    </span>
                                    {candidateProviderId === CUSTOM_PROVIDER_ID && (
                                      <Icon name="check" className="h-4 w-4 text-[var(--primary-base)]" />
                                    )}
                                  </DropdownMenuItem>
                                ) : null}
                              </>
                            );
                          })()}
                        </ScrollableOverlay>
                      </DropdownMenuContent>
                    </DropdownMenu>
                    </>
                   )}
              </div>
        </SettingsSection>

          {isCustomCreateMode ? (
            <CustomProviderForm
              mode="create"
              existingProviderIDs={connectedProviderIds}
              busy={authBusyKey?.startsWith('custom:') ?? false}
              authFailureHint={customAuthFailureHint}
              onCancel={() => {
                setCandidateProviderId('');
                setCustomAuthFailureHint(null);
                setLastCustomPersistId(null);
              }}
              onDisconnect={
                customAuthFailureHint && lastCustomPersistId
                  ? () => void handleDisconnectCustomProvider(lastCustomPersistId)
                  : undefined
              }
              onSubmit={handleSaveCustomProvider}
            />
          ) : candidateProviderId ? (
            <SettingsSection
              title={t('settings.providers.page.auth.title')}
              settingsItem="providers.auth"
              contentClassName="space-y-4"
            >
              {authLoading ? (
                <p className="typography-meta text-muted-foreground">{t('settings.providers.page.auth.loadingMethods')}</p>
              ) : (
                <>
                  {(() => {
                    const candidateAuthMethods = authMethodsByProvider[candidateProviderId] ?? [];
                    const candidateOAuthMethods = toOAuthMethods(
                      getOAuthAuthMethods(candidateAuthMethods),
                      oauthMethodFallbackLabel,
                    );
                    const showApiKey = shouldShowApiKeyAuth(candidateAuthMethods);

                    return (
                      <>
                        {isPiKernel && isOfficialSubscriptionId(candidateProviderId) ? (
                          <SettingsFieldRow
                            label={t('settings.providers.page.subscription.displayName.label')}
                            info={t('settings.providers.page.subscription.displayName.info')}
                            settingsItem="providers.subscription-display-name"
                          >
                            <Input
                              value={displayNameInputs[candidateProviderId] ?? ''}
                              onChange={(event) => setDisplayNameInputs((prev) => ({
                                ...prev,
                                [candidateProviderId]: event.target.value,
                              }))}
                              onBlur={() => void handleSaveDisplayName(candidateProviderId)}
                              placeholder={t('settings.providers.page.subscription.displayName.placeholder')}
                              className="h-8"
                            />
                          </SettingsFieldRow>
                        ) : null}
                        {isPiKernel && kimiSlotActive && isKimiSubscriptionId(candidateProviderId) ? (
                          <SettingsFieldRow
                            label={t('settings.providers.page.subscription.region.label')}
                            info={t('settings.providers.page.subscription.region.info')}
                            settingsItem="providers.subscription-kimi-region"
                          >
                            <SettingsChipGroup
                              value={regionByProvider[candidateProviderId] ?? 'international'}
                              aria-label={t('settings.providers.page.subscription.region.aria')}
                              onChange={(value) => {
                                setRegionByProvider((prev) => ({ ...prev, [candidateProviderId]: value }));
                                if (connectedProviderIds.has(candidateProviderId)) {
                                  void handleSaveRegion(candidateProviderId, value);
                                }
                              }}
                              options={[
                                { value: 'international', label: t('settings.featurePlugins.slot.kimi.region.international') },
                                { value: 'domestic', label: t('settings.featurePlugins.slot.kimi.region.domestic') },
                              ]}
                            />
                          </SettingsFieldRow>
                        ) : null}
                        {candidateOAuthMethods.length > 0 ? (
                          <ProviderOAuthMethods
                            key={candidateProviderId}
                            providerId={candidateProviderId}
                            methods={candidateOAuthMethods}
                            onConnected={() => handleOAuthConnected(candidateProviderId)}
                          />
                        ) : null}

                        {showApiKey ? (
                          <div className={cn('py-1.5', candidateOAuthMethods.length > 0 && 'border-t border-[var(--surface-subtle)] pt-2')}>
                            <label className="typography-ui-label text-foreground flex items-center gap-1.5">
                              {t('settings.providers.page.auth.apiKeyLabel')}
                              <SettingsInfoHint>{t('settings.providers.page.auth.apiKeyTooltip')}</SettingsInfoHint>
                            </label>
                            <div className="flex flex-col @xl:flex-row @xl:items-center gap-2 mt-1.5">
                              <Input
                                type="password"
                                value={apiKeyInputs[candidateProviderId] ?? ''}
                                onChange={(event) =>
                                  setApiKeyInputs((prev) => ({
                                    ...prev,
                                    [candidateProviderId]: event.target.value,
                                  }))
                                }
                                placeholder={t('settings.providers.page.auth.apiKeyPlaceholder')}
                                className="flex-1 font-mono text-xs"
                              />
                              <Button
                                size="xs"
                                className="!font-normal shrink-0"
                                onClick={() => handleSaveApiKey(candidateProviderId)}
                                disabled={authBusyKey === `api:${candidateProviderId}`}
                              >
                                {authBusyKey === `api:${candidateProviderId}` ? t('settings.providers.page.actions.saving') : t('settings.providers.page.actions.saveKey')}
                              </Button>
                            </div>
                          </div>
                        ) : null}
                      </>
                    );
                  })()}
                </>
              )}
            </SettingsSection>
          ) : null}
      </SettingsPageLayout>
    );
  }

  if (!selectedProvider) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center text-muted-foreground">
          <Icon name="stack" className="mx-auto mb-3 h-12 w-12 opacity-50" />
          <p className="typography-body">{t('settings.providers.page.empty.selectProviderFromSidebar')}</p>
          <p className="typography-meta mt-1 opacity-75">{t('settings.providers.page.empty.reviewDetailsAndConfigureAuth')}</p>
        </div>
      </div>
    );
  }

  const providerModels = Array.isArray(selectedProvider.models) ? selectedProvider.models : [];
  const dualCatalogId = dualAuthCatalogId(selectedProvider.id);
  const isDualAuthSurface = Boolean(dualCatalogId);
  const oauthProviderId = dualCatalogId ?? selectedProvider.id;
  const apiKeyProviderId = dualAuthSiblingId(oauthProviderId) ?? selectedProvider.id;
  const providerAuthMethods = authMethodsByProvider[oauthProviderId] ?? authMethodsByProvider[selectedProvider.id] ?? [];
  const oauthAuthMethods = toOAuthMethods(
    getOAuthAuthMethods(providerAuthMethods),
    oauthMethodFallbackLabel,
  );
  const showApiKeyAuth = shouldShowApiKeyAuth(providerAuthMethods);
  const sourcesLoaded = Boolean(selectedSources);
  const isEditableCustomProvider = sourcesLoaded
    && isConfigDefinedCustomProvider(selectedProvider, selectedSources);
  const oauthConnected = selectedSources?.oauth?.exists === true;
  const apiKeyConnected = selectedSources?.apiKey?.exists === true;
  const hasCredentials = providerHasCredentials({
    key: (selectedProvider as { key?: string | null }).key,
    authSourceExists: selectedSources?.auth.exists,
    optionsApiKey: (selectedProvider as { options?: { apiKey?: string | null } }).options?.apiKey ?? null,
    envDeclared: providerDeclaresEnv(selectedProvider),
  }) || (isDualAuthSurface && (oauthConnected || apiKeyConnected));
  const authStatusIncomplete = requiresProviderAuth(
    sourcesLoaded,
    hasCredentials,
    isEditableCustomProvider,
  );
  const showModelsSection = shouldShowModelsSection({
    modelCount: providerModels.length,
    sourcesLoaded,
    hasCredentials,
    isEditableCustomProvider,
  });
  const connectedStatusLabel = isDualAuthSurface && oauthConnected && apiKeyConnected
    ? t('settings.providers.page.auth.oauthAndApiKeyConnected')
    : isDualAuthSurface && oauthConnected
      ? t('settings.providers.page.auth.oauthConnected')
      : isDualAuthSurface && apiKeyConnected
        ? t('settings.providers.page.auth.apiKeyConnected')
        : t('settings.providers.page.auth.connected');
  const incompleteAuthHint = isDualAuthSurface
    ? t('settings.providers.page.auth.dualHint')
    : !showApiKeyAuth && oauthAuthMethods.length > 0
      ? t('settings.providers.page.auth.useReconnectHint')
      : t('settings.providers.page.auth.incompleteHint');
  const connectedAuthHint = isDualAuthSurface
    ? t('settings.providers.page.auth.dualHint')
    : t('settings.providers.page.auth.useReconnectHint');
  const apiKeyBusyId = isDualAuthCatalogId(selectedProvider.id) ? selectedProvider.id : apiKeyProviderId;

  const filteredModels = rankByQuery(providerModels, modelQuery, (model) => [
    typeof model?.name === 'string' ? model.name : '',
    typeof model?.id === 'string' ? model.id : '',
  ]);

  if (isCustomEditMode && isEditableCustomProvider && editingCustomFormInitial) {
    return (
      <SettingsPageLayout
        title={selectedProvider.name || selectedProvider.id}
        titleLeading={<ProviderLogo providerId={selectedProvider.id} className="h-5 w-5 shrink-0" />}
        description={<span className="font-mono typography-settings-description text-muted-foreground">{selectedProvider.id}</span>}
        showSaveStatus={false}
      >
        <CustomProviderForm
          mode="edit"
          existingProviderIDs={connectedProviderIds}
          initialValues={editingCustomFormInitial}
          allowExistingAuth={hasCredentials || !sourcesLoaded}
          busy={authBusyKey?.startsWith('custom:') ?? false}
          authFailureHint={customAuthFailureHint}
          onCancel={() => {
            setEditingCustomProviderId(null);
            setEditingCustomFormInitial(null);
            setEditingCustomScope(null);
            setCustomAuthFailureHint(null);
            setLastCustomPersistId(null);
          }}
          onDisconnect={() => void handleDisconnectCustomProvider(selectedProvider.id)}
          onSubmit={handleSaveCustomProvider}
        />
      </SettingsPageLayout>
    );
  }

  return (
    <SettingsPageLayout
      title={selectedProvider.name || selectedProvider.id}
      titleLeading={<ProviderLogo providerId={selectedProvider.id} className="h-5 w-5 shrink-0" />}
      description={<span className="font-mono typography-settings-description text-muted-foreground">{selectedProvider.id}</span>}
      showSaveStatus={false}
    >
      <SettingsSection
        title={t('settings.providers.page.auth.title')}
        divider={false}
        headerAction={(
          <div className="flex items-center gap-1">
            {isEditableCustomProvider ? (
              <Button
                variant="outline"
                size="xs"
                className="!font-normal"
                onClick={() => {
                  setCustomAuthFailureHint(null);
                  setEditingCustomFormInitial(providerToCustomFormState(selectedProvider));
                  setEditingCustomScope(resolveProviderConfigScope(selectedSources));
                  setEditingCustomProviderId(selectedProvider.id);
                }}
              >
                {t('settings.providers.page.actions.edit')}
              </Button>
            ) : null}
            <Button
              variant="outline"
              size="xs"
              className="!font-normal"
              onClick={() => {
                const nextOpen = !showAuthPanel;
                setShowAuthPanel(nextOpen);
                setAuthPanelDismissedForId(nextOpen ? null : selectedProvider.id);
              }}
            >
              {showAuthPanel ? t('settings.providers.page.actions.hide') : t('settings.providers.page.actions.reconnect')}
            </Button>
          </div>
        )}
        settingsItem="providers.auth"
      >
            {!showAuthPanel ? (
              authStatusIncomplete ? (
                <div className="flex items-center gap-1.5 py-1.5">
                  <Icon name="alert" className="w-4 h-4 text-[var(--status-warning)] shrink-0" />
                  <span className="typography-ui-label text-foreground">{t('settings.providers.page.auth.incomplete')}</span>
                  <SettingsInfoHint>{incompleteAuthHint}</SettingsInfoHint>
                </div>
              ) : (
                <div className="flex items-center gap-1.5 py-1.5">
                  <Icon name="check" className="w-4 h-4 text-[var(--status-success)] shrink-0" />
                  <span className="typography-ui-label text-foreground">{connectedStatusLabel}</span>
                  <SettingsInfoHint>{connectedAuthHint}</SettingsInfoHint>
                </div>
              )
            ) : authLoading ? (
              <div className="py-1.5 typography-meta text-muted-foreground">{t('settings.providers.page.auth.loadingMethods')}</div>
            ) : (
              <div className="space-y-4">
                {oauthAuthMethods.length > 0 && (
                  <div className="space-y-3">
                    <ProviderOAuthMethods
                      key={oauthProviderId}
                      providerId={oauthProviderId}
                      methods={oauthAuthMethods}
                      onConnected={() => handleOAuthConnected(oauthProviderId)}
                    />
                    {isDualAuthSurface && oauthConnected ? (
                      <Button
                        variant="ghost"
                        size="xs"
                        className="!font-normal text-[var(--status-error)] hover:text-[var(--status-error)]"
                        onClick={() => handleDisconnectProvider(oauthProviderId)}
                        disabled={authBusyKey === `disconnect:${oauthProviderId}`}
                      >
                        {authBusyKey === `disconnect:${oauthProviderId}`
                          ? t('settings.providers.page.actions.disconnecting')
                          : t('settings.providers.page.actions.disconnectOAuth')}
                      </Button>
                    ) : null}
                  </div>
                )}

                {showApiKeyAuth ? (
                  <div className={cn('py-1.5', oauthAuthMethods.length > 0 && 'border-t border-[var(--surface-subtle)] pt-2')}>
                    <label className="typography-ui-label text-foreground flex items-center gap-1.5">
                      {t('settings.providers.page.auth.apiKeyLabel')}
                      <SettingsInfoHint>
                        {isDualAuthSurface
                          ? t('settings.providers.page.auth.dualHint')
                          : t('settings.providers.page.auth.apiKeyTooltip')}
                      </SettingsInfoHint>
                    </label>
                    <div className="flex flex-col @xl:flex-row @xl:items-center gap-2 mt-1.5">
                      <Input
                        type="password"
                        value={apiKeyInputs[apiKeyBusyId] ?? ''}
                        onChange={(event) =>
                          setApiKeyInputs((prev) => ({
                            ...prev,
                            [apiKeyBusyId]: event.target.value,
                          }))
                        }
                        placeholder={t('settings.providers.page.auth.apiKeyPlaceholder')}
                        className="flex-1 font-mono text-xs"
                      />
                      <Button
                        size="xs"
                        className="!font-normal shrink-0"
                        onClick={() => handleSaveApiKey(isDualAuthApiSiblingId(selectedProvider.id) ? selectedProvider.id : oauthProviderId)}
                        disabled={authBusyKey === `api:${isDualAuthApiSiblingId(selectedProvider.id) ? selectedProvider.id : oauthProviderId}`}
                      >
                        {authBusyKey === `api:${isDualAuthApiSiblingId(selectedProvider.id) ? selectedProvider.id : oauthProviderId}`
                          ? t('settings.providers.page.actions.saving')
                          : t('settings.providers.page.actions.saveKey')}
                      </Button>
                    </div>
                    {isDualAuthSurface && apiKeyConnected ? (
                      <Button
                        variant="ghost"
                        size="xs"
                        className="!font-normal text-[var(--status-error)] hover:text-[var(--status-error)] mt-2"
                        onClick={() => handleDisconnectProvider(apiKeyProviderId)}
                        disabled={authBusyKey === `disconnect:${apiKeyProviderId}`}
                      >
                        {authBusyKey === `disconnect:${apiKeyProviderId}`
                          ? t('settings.providers.page.actions.disconnecting')
                          : t('settings.providers.page.actions.disconnectApiKey')}
                      </Button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            )}
      </SettingsSection>

      {isPiKernel && isOfficialSubscriptionId(selectedProvider.id) ? (
        <SettingsSection title={t('settings.providers.page.subscription.displayName.section')}>
          <SettingsFieldRow
            label={t('settings.providers.page.subscription.displayName.label')}
            info={t('settings.providers.page.subscription.displayName.info')}
            settingsItem="providers.subscription-display-name"
          >
            <Input
              value={displayNameInputs[selectedProvider.id] ?? selectedProvider.name ?? ''}
              onChange={(event) => setDisplayNameInputs((prev) => ({
                ...prev,
                [selectedProvider.id]: event.target.value,
              }))}
              onBlur={() => void handleSaveDisplayName(selectedProvider.id)}
              placeholder={t('settings.providers.page.subscription.displayName.placeholder')}
              className="h-8"
            />
          </SettingsFieldRow>
          {kimiSlotActive && isKimiSubscriptionId(selectedProvider.id) ? (
            <SettingsFieldRow
              label={t('settings.providers.page.subscription.region.label')}
              info={t('settings.providers.page.subscription.region.info')}
              settingsItem="providers.subscription-kimi-region"
            >
              <SettingsChipGroup
                value={regionByProvider[selectedProvider.id] ?? 'international'}
                aria-label={t('settings.providers.page.subscription.region.aria')}
                onChange={(value) => void handleSaveRegion(selectedProvider.id, value)}
                options={[
                  { value: 'international', label: t('settings.featurePlugins.slot.kimi.region.international') },
                  { value: 'domestic', label: t('settings.featurePlugins.slot.kimi.region.domestic') },
                ]}
              />
            </SettingsFieldRow>
          ) : null}
        </SettingsSection>
      ) : null}

      {xaiSlotActive && isXaiSubscriptionId(selectedProvider.id) && hasCredentials ? (
        <ProviderXaiUsage providerId={selectedProvider.id} />
      ) : null}

      {kimiSlotActive && isKimiSubscriptionId(selectedProvider.id) && hasCredentials ? (
        <ProviderKimiUsage providerId={selectedProvider.id} />
      ) : null}

      <SettingsSection
        title={t('settings.providers.page.connectionDetails.title')}
        settingsItem="providers.connection-details"
      >
            <div className="flex flex-col gap-2 py-1.5 @xl:flex-row @xl:items-center @xl:justify-between @xl:gap-8">
              <div className="flex min-w-0 flex-col">
                {selectedSources && (selectedSources.auth.exists || selectedSources.user.exists || selectedSources.project.exists || selectedSources.custom?.exists) ? (
                  <span className="typography-meta text-muted-foreground">
                    {t('settings.providers.page.connectionDetails.configuredIn')}{' '}
                    {[
                      selectedSources.auth.exists ? t('settings.providers.page.connectionDetails.source.authCredentials') : null,
                      selectedSources.user.exists ? t('settings.providers.page.connectionDetails.source.userConfig') : null,
                      selectedSources.project.exists ? t('settings.providers.page.connectionDetails.source.projectConfig') : null,
                      selectedSources.custom?.exists ? t('settings.providers.page.connectionDetails.source.customConfig') : null,
                    ].filter(Boolean).join(', ')}
                  </span>
                ) : (
                  <span className="typography-meta text-muted-foreground">{t('settings.providers.page.connectionDetails.noActiveSource')}</span>
                )}
              </div>

              {isDualAuthSurface && oauthConnected && apiKeyConnected ? (
                <div className="flex flex-wrap items-center gap-1">
                  <Button
                    variant="ghost"
                    size="xs"
                    className="!font-normal text-[var(--status-error)] hover:text-[var(--status-error)]"
                    onClick={() => handleDisconnectProvider(oauthProviderId)}
                    disabled={authBusyKey === `disconnect:${oauthProviderId}`}
                  >
                    {authBusyKey === `disconnect:${oauthProviderId}`
                      ? t('settings.providers.page.actions.disconnecting')
                      : t('settings.providers.page.actions.disconnectOAuth')}
                  </Button>
                  <Button
                    variant="ghost"
                    size="xs"
                    className="!font-normal text-[var(--status-error)] hover:text-[var(--status-error)]"
                    onClick={() => handleDisconnectProvider(apiKeyProviderId)}
                    disabled={authBusyKey === `disconnect:${apiKeyProviderId}`}
                  >
                    {authBusyKey === `disconnect:${apiKeyProviderId}`
                      ? t('settings.providers.page.actions.disconnecting')
                      : t('settings.providers.page.actions.disconnectApiKey')}
                  </Button>
                </div>
              ) : (
                <Button
                  variant="ghost"
                  size="xs"
                  className="!font-normal text-[var(--status-error)] hover:text-[var(--status-error)]"
                  onClick={() => handleDisconnectProvider(
                    isDualAuthSurface && apiKeyConnected && !oauthConnected
                      ? apiKeyProviderId
                      : selectedProvider.id,
                  )}
                  disabled={authBusyKey === `disconnect:${isDualAuthSurface && apiKeyConnected && !oauthConnected ? apiKeyProviderId : selectedProvider.id}`}
                >
                  {authBusyKey === `disconnect:${isDualAuthSurface && apiKeyConnected && !oauthConnected ? apiKeyProviderId : selectedProvider.id}`
                    ? t('settings.providers.page.actions.disconnecting')
                    : t('settings.providers.page.actions.disconnect')}
                </Button>
              )}
            </div>
      </SettingsSection>

      {showModelsSection ? (
      <SettingsSection
        title={t('settings.providers.page.models.title')}
        titleAccessory={
          <span className="typography-micro text-muted-foreground font-normal">
            ({providerModels.length})
          </span>
        }
        headerAction={(
          <div className="flex items-center gap-1">
            {isEditableCustomProvider ? (
              <Button
                variant="outline"
                size="xs"
                className="!font-normal"
                disabled={customModelsSyncBusy || !hasCredentials}
                onClick={() => {
                  customModelsSyncedForRef.current = null;
                  void syncCustomProviderModels(selectedProvider.id, {
                    scope: resolveProviderConfigScope(selectedSources),
                  });
                }}
              >
                {customModelsSyncBusy
                  ? t('settings.providers.page.actions.syncingModels')
                  : t('settings.providers.page.actions.syncModels')}
              </Button>
            ) : null}
            <Button
              variant="outline"
              size="xs"
              className="!font-normal"
              onClick={() => {
                const allIds = providerModels
                  .map((model) => (typeof model?.id === 'string' ? model.id : ''))
                  .filter((id) => id.length > 0);
                hideAllModels(selectedProvider.id, allIds);
              }}
            >
              {t('settings.providers.page.actions.hideAll')}
            </Button>
            <Button
              variant="outline"
              size="xs"
              className="!font-normal"
              onClick={() => showAllModels(selectedProvider.id)}
            >
              {t('settings.providers.page.actions.showAll')}
            </Button>
          </div>
        )}
        settingsItem="providers.models"
      >
            <div className="relative mb-2">
              <Icon name="search" className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                value={modelQuery}
                onChange={(event) => setModelQuery(event.target.value)}
                placeholder={t('settings.providers.page.models.filterPlaceholder')}
                className="h-7 pl-8 w-full"
              />
            </div>

            {filteredModels.length === 0 ? (
              <p className="typography-meta text-muted-foreground py-4 text-center">{t('settings.providers.page.models.noModelsMatchFilter')}</p>
            ) : (
              <div className="divide-y divide-[var(--surface-subtle)]">
                {filteredModels.map((model) => {
                  const modelId = typeof model?.id === 'string' ? model.id : '';
                  const modelName = typeof model?.name === 'string' ? model.name : modelId;
                  const metadata = modelId ? getModelMetadata(selectedProvider.id, modelId) as ModelMetadata | undefined : undefined;
                  const isHidden = hiddenModels.some(
                    (item) => item.providerID === selectedProvider.id && item.modelID === modelId
                  );

                  const contextTokens = formatTokens(metadata?.limit?.context);
                  const outputTokens = formatTokens(metadata?.limit?.output);

                  const capabilityIcons: Array<{ key: string; icon: IconName; label: string }> = [];
                  if (metadata?.tool_call) capabilityIcons.push({ key: 'tools', icon: "tools", label: t('settings.providers.page.models.capability.toolCalling') });
                  if (metadata?.reasoning) capabilityIcons.push({ key: 'reasoning', icon: "brain-ai-3", label: t('settings.providers.page.models.capability.reasoning') });
                  if (metadata?.attachment) capabilityIcons.push({ key: 'image', icon: "file-image", label: t('settings.providers.page.models.capability.imageInput') });

                  return (
                    <div key={modelId} className="py-1.5">
                      <div
                        className={cn(
                          "flex items-center gap-3",
                          isHidden && 'opacity-50',
                        )}
                      >
                      <span className="typography-meta font-medium text-foreground truncate flex-1 min-w-0">
                        {modelName}
                      </span>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {(contextTokens || outputTokens) && (
                          <span className="typography-micro text-muted-foreground flex-shrink-0 bg-[var(--surface-muted)] px-1.5 py-0.5 rounded">
                            {contextTokens ? `${contextTokens} ${t('settings.providers.page.models.tokenBadge.context')}` : ''}
                            {contextTokens && outputTokens ? ' · ' : ''}
                            {outputTokens ? `${outputTokens} ${t('settings.providers.page.models.tokenBadge.output')}` : ''}
                          </span>
                        )}
                        {capabilityIcons.length > 0 && (
                          <div className="flex items-center gap-1 flex-shrink-0">
                            {capabilityIcons.map(({ key, icon: iconName, label }) => (
                              <span
                                key={key}
                                className="flex h-5 w-5 rounded items-center justify-center text-muted-foreground bg-[var(--surface-muted)]"
                                title={label}
                                aria-label={label}
                              >
                                <Icon name={iconName} className="h-3 w-3" />
                              </span>
                            ))}
                          </div>
                        )}
                        <button
                          type="button"
                          onClick={() => toggleHiddenModel(selectedProvider.id, modelId)}
                          className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-[var(--interactive-hover)]/50"
                          title={isHidden ? t('settings.providers.page.models.actions.showModelInSelectors') : t('settings.providers.page.models.actions.hideModelFromSelectors')}
                          aria-label={isHidden ? t('settings.providers.page.models.actions.showModel') : t('settings.providers.page.models.actions.hideModel')}
                        >
                          {isHidden ? <Icon name="eye-off" className="h-3.5 w-3.5" /> : <Icon name="eye" className="h-3.5 w-3.5" />}
                        </button>
                      </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
      </SettingsSection>
      ) : null}
    </SettingsPageLayout>
  );
};
