import React from 'react';
import { ModelSelector } from '@/components/sections/agents/ModelSelector';
import { AgentSelector } from '@/components/sections/commands/AgentSelector';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { NumberInput } from '@/components/ui/number-input';
import {
  SettingsSection,
  SettingsFieldRow,
  SettingsCheckboxRow,
  SettingsInset,
  SettingsGroupTitle,
  SETTINGS_CUSTOM_TRIGGER_CLASS,
  SETTINGS_SELECT_ROW_TRIGGER_CLASS,
  SETTINGS_SELECT_SIZE,
  SETTINGS_OPTION_STACK_CLASS,
  SETTINGS_NUMBER_STEPPER_ROW_CLASS,
  SETTINGS_NUMBER_UNIT_CLASS,
} from '@/components/sections/shared/SettingsSection';
import { SettingsInfoHint } from '@/components/sections/shared/SettingsInfoHint';
import { reportSettingsSaveState, updateDesktopSettings } from '@/lib/persistence';
import { useConfigStore } from '@/stores/useConfigStore';
import { useUIStore } from '@/stores/useUIStore';
import { getRegisteredRuntimeAPIs } from '@/contexts/runtimeAPIRegistry';
import { useI18n } from '@/lib/i18n';
import { parseModelIdentifier } from '@/lib/modelIdentifier';
import { lookupModelMetadata } from '@/lib/modelMetadata';
import { runtimeFetch } from '@/lib/runtime-fetch';
import { shouldShowOpenCodeAgentPicker, usePiKernel } from '@/lib/usePiKernel';

const getDisplayModel = (
  storedModel: string | undefined
): { providerId: string; modelId: string } => {
  const parsed = parseModelIdentifier(storedModel);
  if (parsed) {
    return parsed;
  }

  return { providerId: '', modelId: '' };
};

export const DefaultsSettings: React.FC = () => {
  const { t } = useI18n();
  const isPiKernel = usePiKernel();
  const setProvider = useConfigStore((state) => state.setProvider);
  const setModel = useConfigStore((state) => state.setModel);
  const setAgent = useConfigStore((state) => state.setAgent);
  const setCurrentVariant = useConfigStore((state) => state.setCurrentVariant);
  const setSettingsDefaultModel = useConfigStore((state) => state.setSettingsDefaultModel);
  const setSettingsDefaultVariant = useConfigStore((state) => state.setSettingsDefaultVariant);
  const setSettingsDefaultAgent = useConfigStore((state) => state.setSettingsDefaultAgent);
  const showDeletionDialog = useUIStore((state) => state.showDeletionDialog);
  const setShowDeletionDialog = useUIStore((state) => state.setShowDeletionDialog);
  const providers = useConfigStore((state) => state.providers);
  const modelsMetadata = useConfigStore((state) => state.modelsMetadata);

  const [defaultModel, setDefaultModel] = React.useState<string | undefined>();
  const [defaultVariant, setDefaultVariant] = React.useState<string | undefined>();
  const [defaultAgent, setDefaultAgent] = React.useState<string | undefined>();
  const [smallModelUseDefault, setSmallModelUseDefault] = React.useState(true);
  const [smallModelOverride, setSmallModelOverride] = React.useState<string | undefined>();
  const [smallModelProviders, setSmallModelProviders] = React.useState<string[]>([]);
  const [walkthroughModelOverride, setWalkthroughModelOverride] = React.useState<string | undefined>();
  const [thinkingLevel, setThinkingLevel] = React.useState('medium');
  const [compaction, setCompaction] = React.useState(true);
  const [retry, setRetry] = React.useState(true);
  const [reserveTokens, setReserveTokens] = React.useState(16384);
  const [keepRecentTokens, setKeepRecentTokens] = React.useState(20000);
  const [maxRetries, setMaxRetries] = React.useState(3);
  const [baseDelayMs, setBaseDelayMs] = React.useState(2000);
  const [enabledModels, setEnabledModels] = React.useState<string[]>([]);
  const [catalogModels, setCatalogModels] = React.useState<Array<{ key: string; label: string }>>([]);
  const [isLoading, setIsLoading] = React.useState(true);
  const PI_THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const;

  const parsedModel = React.useMemo(() => getDisplayModel(defaultModel), [defaultModel]);

  React.useEffect(() => {
    const loadSettings = async () => {
      try {
        let data: {
          defaultModel?: string;
          defaultVariant?: string;
          defaultAgent?: string;
          smallModelUseDefault?: boolean;
          smallModelOverride?: string;
          walkthroughModelOverride?: string;
        } | null = null;

        if (!data) {
          const runtimeSettings = getRegisteredRuntimeAPIs()?.settings;
          if (runtimeSettings) {
            try {
              const result = await runtimeSettings.load();
              const settings = result?.settings;
              if (settings) {
                const raw = settings as Record<string, unknown>;
                data = {
                  defaultModel: typeof settings.defaultModel === 'string' ? settings.defaultModel : undefined,
                  defaultVariant:
                    typeof raw.defaultVariant === 'string'
                      ? (raw.defaultVariant as string)
                      : undefined,
                  defaultAgent: typeof settings.defaultAgent === 'string' ? settings.defaultAgent : undefined,
                  smallModelUseDefault: typeof raw.smallModelUseDefault === 'boolean' ? raw.smallModelUseDefault : undefined,
                  smallModelOverride: typeof raw.smallModelOverride === 'string' ? raw.smallModelOverride : undefined,
                  walkthroughModelOverride:
                    typeof raw.walkthroughModelOverride === 'string' ? raw.walkthroughModelOverride : undefined,
                };
              }
            } catch {
              // fall through
            }
          }
        }

        if (!data) {
          const response = await runtimeFetch('/api/config/settings', {
            method: 'GET',
            headers: { Accept: 'application/json' },
          });
          if (response.ok) {
            data = await response.json();
          }
        }

        try {
          const piDefaultsResponse = await runtimeFetch('/api/pi/defaults', {
            method: 'GET',
            headers: { Accept: 'application/json' },
          });
          if (piDefaultsResponse.ok) {
            const piDefaults = await piDefaultsResponse.json() as {
              model?: string;
              resolvedModel?: string;
              thinking?: string;
              compaction?: boolean;
              retry?: boolean;
              compactionSettings?: { enabled?: boolean; reserveTokens?: number; keepRecentTokens?: number };
              retrySettings?: { enabled?: boolean; maxRetries?: number; baseDelayMs?: number };
              enabledModels?: unknown;
            };
            const stored = typeof piDefaults.model === 'string' ? piDefaults.model.trim() : '';
            const resolved = typeof piDefaults.resolvedModel === 'string' ? piDefaults.resolvedModel.trim() : '';
            // Empty stored model means "first catalog model" — show that, not "Not selected".
            if (stored || resolved) {
              setDefaultModel(stored || resolved);
            }
            if (typeof piDefaults.thinking === 'string' && piDefaults.thinking.trim()) {
              setThinkingLevel(piDefaults.thinking.trim());
            }
            if (typeof piDefaults.compaction === 'boolean') setCompaction(piDefaults.compaction);
            if (typeof piDefaults.retry === 'boolean') setRetry(piDefaults.retry);
            if (typeof piDefaults.compactionSettings?.reserveTokens === 'number') setReserveTokens(piDefaults.compactionSettings.reserveTokens);
            if (typeof piDefaults.compactionSettings?.keepRecentTokens === 'number') setKeepRecentTokens(piDefaults.compactionSettings.keepRecentTokens);
            if (typeof piDefaults.retrySettings?.maxRetries === 'number') setMaxRetries(piDefaults.retrySettings.maxRetries);
            if (typeof piDefaults.retrySettings?.baseDelayMs === 'number') setBaseDelayMs(piDefaults.retrySettings.baseDelayMs);
            if (Array.isArray(piDefaults.enabledModels)) {
              setEnabledModels(piDefaults.enabledModels.filter((item): item is string => typeof item === 'string' && item.trim().length > 0));
            }
          }
        } catch {
          // Pi defaults are optional when the kernel route is unavailable.
        }

        try {
          const modelsResponse = await runtimeFetch('/api/pi/models', {
            method: 'GET',
            headers: { Accept: 'application/json' },
          });
          if (modelsResponse.ok) {
            const payload = await modelsResponse.json() as {
              providers?: Array<{ id?: string; models?: Record<string, { id?: string; name?: string }> }>;
            };
            const items: Array<{ key: string; label: string }> = [];
            for (const provider of payload.providers || []) {
              if (!provider?.id || !provider.models) continue;
              for (const [modelId, model] of Object.entries(provider.models)) {
                const key = `${provider.id}/${modelId}`;
                items.push({ key, label: model?.name || modelId });
              }
            }
            setCatalogModels(items);
            if (isPiKernel && items[0]?.key) {
              setDefaultModel((current) => current && current.trim() ? current : items[0].key);
            }
          }
        } catch {
          // Catalog is optional when the kernel route is unavailable.
        }

        if (data) {
          const model =
            typeof data.defaultModel === 'string' && data.defaultModel.trim().length > 0
              ? data.defaultModel.trim()
              : undefined;
          const variant =
            typeof data.defaultVariant === 'string' && data.defaultVariant.trim().length > 0
              ? data.defaultVariant.trim()
              : undefined;
          const agent =
            typeof data.defaultAgent === 'string' && data.defaultAgent.trim().length > 0
              ? data.defaultAgent.trim()
              : undefined;

          if (model !== undefined && !isPiKernel) setDefaultModel(model);
          if (variant !== undefined) setDefaultVariant(variant);
          if (agent !== undefined) setDefaultAgent(agent);
          if (typeof data.smallModelUseDefault === 'boolean') setSmallModelUseDefault(data.smallModelUseDefault);
          if (typeof data.smallModelOverride === 'string' && data.smallModelOverride.trim()) {
            setSmallModelOverride(data.smallModelOverride.trim());
          }
          if (typeof data.walkthroughModelOverride === 'string' && data.walkthroughModelOverride.trim()) {
            setWalkthroughModelOverride(data.walkthroughModelOverride.trim());
          }
        }
      } catch (error) {
        console.warn('Failed to load defaults settings:', error);
      } finally {
        setIsLoading(false);
      }
    };
    loadSettings();
  }, [isPiKernel]);

  const handleModelChange = React.useCallback(
    async (providerId: string, modelId: string) => {
      const newValue = providerId && modelId ? `${providerId}/${modelId}` : undefined;
      setDefaultModel(newValue);
      setDefaultVariant(undefined);
      setSettingsDefaultVariant(undefined);
      setCurrentVariant(undefined);
      setSettingsDefaultModel(newValue);

      if (providerId && modelId) {
        const provider = providers.find((p) => p.id === providerId);
        if (provider) {
          setProvider(providerId);
          setModel(modelId);
        }
      }

      try {
        await updateDesktopSettings({ defaultModel: newValue ?? '', defaultVariant: '' });
        const response = await runtimeFetch('/api/config/settings', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ defaultModel: newValue }),
        });
        await runtimeFetch('/api/pi/defaults', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: newValue ?? '' }),
        }).catch(() => undefined);
        if (!response.ok) {
          console.warn('Failed to save default model to server:', response.status, response.statusText);
        }
      } catch (error) {
        console.warn('Failed to save default model:', error);
      }
    },
    [providers, setCurrentVariant, setModel, setProvider, setSettingsDefaultModel, setSettingsDefaultVariant]
  );

  const DEFAULT_VARIANT_VALUE = '__default__';

  const formatVariantLabel = React.useCallback((variant: string) => {
    if (variant === DEFAULT_VARIANT_VALUE) {
      return t('settings.openchamber.defaults.option.default');
    }
    return variant.charAt(0).toUpperCase() + variant.slice(1);
  }, [t]);

  const handleVariantChange = React.useCallback(
    async (variant: string) => {
      const newValue = variant === DEFAULT_VARIANT_VALUE ? undefined : variant || undefined;
      setDefaultVariant(newValue);
      setSettingsDefaultVariant(newValue);
      setCurrentVariant(newValue);

      try {
        await updateDesktopSettings({ defaultVariant: newValue ?? '' });
      } catch (error) {
        console.warn('Failed to save default variant:', error);
      }
    },
    [setCurrentVariant, setSettingsDefaultVariant]
  );

  const handleAgentChange = React.useCallback(
    async (agentName: string) => {
      const newValue = agentName || undefined;
      setDefaultAgent(newValue);
      setSettingsDefaultAgent(newValue);

      if (agentName) {
        setAgent(agentName);
      }

      try {
        await updateDesktopSettings({ defaultAgent: newValue ?? '' });
      } catch (error) {
        console.warn('Failed to save default agent:', error);
      }
    },
    [setAgent, setSettingsDefaultAgent]
  );

  const handleSmallModelUseDefaultChange = React.useCallback(
    async (useDefault: boolean) => {
      setSmallModelUseDefault(useDefault);
      try {
        await updateDesktopSettings({ smallModelUseDefault: useDefault });
      } catch (error) {
        console.warn('Failed to save small model preference:', error);
      }
    },
    []
  );

  const handleSmallModelOverrideChange = React.useCallback(
    async (providerId: string, modelId: string) => {
      const newValue = providerId && modelId ? `${providerId}/${modelId}` : undefined;
      setSmallModelOverride(newValue);
      try {
        await updateDesktopSettings({ smallModelOverride: newValue ?? '' });
      } catch (error) {
        console.warn('Failed to save small model override:', error);
      }
    },
    []
  );

  const handleWalkthroughModelOverrideChange = React.useCallback(
    async (providerId: string, modelId: string) => {
      const newValue = providerId && modelId ? `${providerId}/${modelId}` : undefined;
      setWalkthroughModelOverride(newValue);
      try {
        // Clearing the picker is how the user goes back to the small model, so
        // an empty value is a real choice rather than a no-op.
        await updateDesktopSettings({ walkthroughModelOverride: newValue ?? '' });
      } catch (error) {
        console.warn('Failed to save walkthrough model override:', error);
      }
    },
    []
  );

  // The walkthrough cannot work at all without schema-shaped output, so models
  // the catalog says cannot do it are hidden rather than offered and then
  // refused. A missing capability is not a "no": roughly half the catalog omits
  // the field, and those models usually work.
  const isStructuredOutputCapable = React.useCallback(
    (providerId: string, modelId: string) =>
      lookupModelMetadata(modelsMetadata, providerId, modelId)?.structured_output !== false,
    [modelsMetadata]
  );

  const parsedSmallModel = React.useMemo(() => getDisplayModel(smallModelOverride), [smallModelOverride]);
  const parsedWalkthroughModel = React.useMemo(
    () => getDisplayModel(walkthroughModelOverride),
    [walkthroughModelOverride]
  );
  React.useEffect(() => {
    // Both pickers filter by the same authenticated-provider list, and the
    // walkthrough picker is always visible, so this is always worth fetching.
    let cancelled = false;
    (async () => {
      try {
        const response = await runtimeFetch('/api/small-model', { method: 'GET', headers: { Accept: 'application/json' } });
        if (!response.ok) return;
        const payload = await response.json().catch(() => null) as { authenticatedProviders?: unknown } | null;
        if (!cancelled && Array.isArray(payload?.authenticatedProviders)) {
          setSmallModelProviders(payload.authenticatedProviders.filter((id): id is string => typeof id === 'string'));
        }
      } catch {
        // Fail closed: never offer providers whose credentials were not verified.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const availableVariants = React.useMemo(() => {
    if (!parsedModel.providerId || !parsedModel.modelId) return [];
    const provider = providers.find((p) => p.id === parsedModel.providerId);
    const model = provider?.models.find((m: Record<string, unknown>) => (m as { id?: string }).id === parsedModel.modelId) as
      | { variants?: Record<string, unknown> }
      | undefined;
    const variants = model?.variants;
    if (!variants) return [];
    return Object.keys(variants);
  }, [parsedModel.modelId, parsedModel.providerId, providers]);

  const supportsVariants = availableVariants.length > 0;

  React.useEffect(() => {
    if (!supportsVariants && defaultVariant) {
      setDefaultVariant(undefined);
      setSettingsDefaultVariant(undefined);
      setCurrentVariant(undefined);
      updateDesktopSettings({ defaultVariant: '' }).catch(() => {
        // best effort
      });
    }
  }, [defaultVariant, setCurrentVariant, setSettingsDefaultVariant, supportsVariants]);

  if (isLoading) {
    return null;
  }

  return (
    <>
      <SettingsSection title={t('settings.openchamber.defaults.title')} divider={false}>
        <div className="space-y-0">
          <div className="mt-0 mb-1 typography-meta text-muted-foreground">
            {t('settings.openchamber.defaults.summaryPrefix')}
            {' '}
            {parsedModel.providerId ? (
              <span className="text-foreground">
                {parsedModel.providerId}/{parsedModel.modelId}
                {!isPiKernel && supportsVariants ? ` (${defaultVariant ?? t('settings.openchamber.defaults.option.defaultLowercase')})` : ''}
              </span>
            ) : (
              <span className="text-foreground">{t('settings.openchamber.defaults.summaryOpenCodeDefault')}</span>
            )}
            {defaultAgent && (
              <>
                {' / '}
                <span className="text-foreground">{defaultAgent}</span>
              </>
            )}
          </div>

          <div>
            <SettingsFieldRow
              settingsItem="sessions.default-model"
              label={t('settings.openchamber.defaults.field.defaultModel')}
            >
              <ModelSelector
                providerId={parsedModel.providerId}
                modelId={parsedModel.modelId}
                onChange={handleModelChange}
                className={SETTINGS_CUSTOM_TRIGGER_CLASS}
              />
            </SettingsFieldRow>

            <SettingsFieldRow
              settingsItem="sessions.default-thinking"
              label={t('settings.openchamber.defaults.field.defaultThinking')}
            >
              <Select
                value={thinkingLevel}
                onValueChange={async (value) => {
                  setThinkingLevel(value);
                  try {
                    await runtimeFetch('/api/pi/defaults', {
                      method: 'PATCH',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ thinking: value }),
                    });
                  } catch (error) {
                    console.warn('Failed to save Pi thinking level:', error);
                  }
                }}
              >
                <SelectTrigger size={SETTINGS_SELECT_SIZE} className={SETTINGS_SELECT_ROW_TRIGGER_CLASS}>
                  <SelectValue placeholder={t('settings.openchamber.defaults.field.thinkingPlaceholder')}>
                    {formatVariantLabel(thinkingLevel)}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {PI_THINKING_LEVELS.map((level) => (
                    <SelectItem key={level} value={level}>
                      {formatVariantLabel(level)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </SettingsFieldRow>

            {shouldShowOpenCodeAgentPicker(isPiKernel) ? (
            <SettingsFieldRow
              settingsItem="sessions.default-agent"
              label={t('settings.openchamber.defaults.field.defaultAgent')}
            >
              <AgentSelector
                agentName={defaultAgent || ''}
                onChange={handleAgentChange}
                className={SETTINGS_CUSTOM_TRIGGER_CLASS}
              />
            </SettingsFieldRow>
            ) : null}
          </div>

          <SettingsInset className={SETTINGS_OPTION_STACK_CLASS}>
            <SettingsCheckboxRow
              settingsItem="sessions.compaction"
              checked={compaction}
              onChange={async (checked) => {
                setCompaction(checked);
                try {
                  await runtimeFetch('/api/pi/defaults', {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ compaction: checked }),
                  });
                } catch (error) {
                  console.warn('Failed to save Pi compaction default:', error);
                }
              }}
              label={t('settings.openchamber.defaults.field.compaction')}
              ariaLabel={t('settings.openchamber.defaults.field.compactionAria')}
            />

            {compaction ? (
              <>
                <SettingsFieldRow
                  settingsItem="sessions.compaction-reserve"
                  label={t('settings.openchamber.defaults.field.reserveTokens')}
                >
                  <div className={SETTINGS_NUMBER_STEPPER_ROW_CLASS}>
                    <NumberInput
                      value={reserveTokens}
                      onValueChange={async (value) => {
                        setReserveTokens(value);
                        try {
                          await runtimeFetch('/api/pi/defaults', {
                            method: 'PATCH',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ compactionSettings: { reserveTokens: value } }),
                          });
                        } catch (error) {
                          console.warn('Failed to save Pi reserve tokens:', error);
                        }
                      }}
                      min={0}
                      max={200000}
                      step={1024}
                      className="w-20 tabular-nums"
                      aria-label={t('settings.openchamber.defaults.field.reserveTokensAria')}
                    />
                  </div>
                </SettingsFieldRow>
                <SettingsFieldRow
                  settingsItem="sessions.compaction-keep"
                  label={t('settings.openchamber.defaults.field.keepRecentTokens')}
                >
                  <div className={SETTINGS_NUMBER_STEPPER_ROW_CLASS}>
                    <NumberInput
                      value={keepRecentTokens}
                      onValueChange={async (value) => {
                        setKeepRecentTokens(value);
                        try {
                          await runtimeFetch('/api/pi/defaults', {
                            method: 'PATCH',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ compactionSettings: { keepRecentTokens: value } }),
                          });
                        } catch (error) {
                          console.warn('Failed to save Pi keep recent tokens:', error);
                        }
                      }}
                      min={0}
                      max={200000}
                      step={1024}
                      className="w-20 tabular-nums"
                      aria-label={t('settings.openchamber.defaults.field.keepRecentTokensAria')}
                    />
                  </div>
                </SettingsFieldRow>
              </>
            ) : null}
            <SettingsCheckboxRow
              settingsItem="sessions.retry"
              checked={retry}
              onChange={async (checked) => {
                setRetry(checked);
                try {
                  await runtimeFetch('/api/pi/defaults', {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ retry: checked }),
                  });
                } catch (error) {
                  console.warn('Failed to save Pi retry default:', error);
                }
              }}
              label={t('settings.openchamber.defaults.field.retry')}
              ariaLabel={t('settings.openchamber.defaults.field.retryAria')}
            />

            {retry ? (
              <>
                <SettingsFieldRow
                  settingsItem="sessions.retry-max"
                  label={t('settings.openchamber.defaults.field.maxRetries')}
                >
                  <div className={SETTINGS_NUMBER_STEPPER_ROW_CLASS}>
                    <NumberInput
                      value={maxRetries}
                      onValueChange={async (value) => {
                        setMaxRetries(value);
                        try {
                          await runtimeFetch('/api/pi/defaults', {
                            method: 'PATCH',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ retrySettings: { maxRetries: value } }),
                          });
                        } catch (error) {
                          console.warn('Failed to save Pi max retries:', error);
                        }
                      }}
                      min={0}
                      max={20}
                      step={1}
                      aria-label={t('settings.openchamber.defaults.field.maxRetriesAria')}
                    />
                  </div>
                </SettingsFieldRow>
                <SettingsFieldRow
                  settingsItem="sessions.retry-delay"
                  label={t('settings.openchamber.defaults.field.baseDelayMs')}
                >
                  <div className={SETTINGS_NUMBER_STEPPER_ROW_CLASS}>
                    <NumberInput
                      value={baseDelayMs}
                      onValueChange={async (value) => {
                        setBaseDelayMs(value);
                        try {
                          await runtimeFetch('/api/pi/defaults', {
                            method: 'PATCH',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ retrySettings: { baseDelayMs: value } }),
                          });
                        } catch (error) {
                          console.warn('Failed to save Pi retry delay:', error);
                        }
                      }}
                      min={0}
                      max={60000}
                      step={250}
                      className="w-20 tabular-nums"
                      aria-label={t('settings.openchamber.defaults.field.baseDelayMsAria')}
                    />
                    <span className={SETTINGS_NUMBER_UNIT_CLASS}>{t('settings.openchamber.defaults.field.ms')}</span>
                  </div>
                </SettingsFieldRow>
              </>
            ) : null}
            <SettingsCheckboxRow
              settingsItem="sessions.deletion-dialog"
              checked={showDeletionDialog}
              onChange={setShowDeletionDialog}
              label={t('settings.openchamber.defaults.field.showDeletionDialog')}
              ariaLabel={t('settings.openchamber.defaults.field.showDeletionDialogAria')}
            />
          </SettingsInset>

          {isPiKernel && catalogModels.length > 0 ? (
            <div className="space-y-3 pt-6">
              <div className="flex items-center gap-1.5">
                <SettingsGroupTitle>
                  {t('settings.openchamber.defaults.section.enabledModels')}
                </SettingsGroupTitle>
                <SettingsInfoHint>
                  {t('settings.openchamber.defaults.field.enabledModelsInfo')}
                </SettingsInfoHint>
              </div>
              <SettingsInset className={SETTINGS_OPTION_STACK_CLASS}>
                {catalogModels.map((item) => {
                  const checked = enabledModels.length === 0 || enabledModels.includes(item.key);
                  return (
                    <SettingsCheckboxRow
                      key={item.key}
                      settingsItem="sessions.enabled-models"
                      checked={checked}
                      onChange={(nextChecked) => {
                        const allKeys = catalogModels.map((model) => model.key);
                        const current = enabledModels.length === 0 ? allKeys : enabledModels;
                        const next = nextChecked
                          ? Array.from(new Set([...current, item.key]))
                          : current.filter((key) => key !== item.key);
                        const persisted = next.length === 0 || next.length === allKeys.length ? [] : next;
                        setEnabledModels(persisted);
                        reportSettingsSaveState('saving');
                        void runtimeFetch('/api/pi/defaults', {
                          method: 'PATCH',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ enabledModels: persisted }),
                        }).then((response) => {
                          reportSettingsSaveState(response.ok ? 'saved' : 'error');
                        }).catch(() => {
                          reportSettingsSaveState('error');
                        });
                      }}
                      label={item.label}
                      ariaLabel={`${t('settings.openchamber.defaults.field.enabledModelsAria')}: ${item.label}`}
                    />
                  );
                })}
              </SettingsInset>
            </div>
          ) : null}

          <div className="space-y-3 pt-6">
            <div className="flex items-center gap-1.5">
              <SettingsGroupTitle>
                {t('settings.openchamber.defaults.smallModel.title')}
              </SettingsGroupTitle>
              <SettingsInfoHint>
                {t('settings.openchamber.defaults.smallModel.description')}
              </SettingsInfoHint>
            </div>

            <SettingsCheckboxRow
              settingsItem="sessions.small-model"
              checked={smallModelUseDefault}
              onChange={(checked) => {
                void handleSmallModelUseDefaultChange(checked);
              }}
              label={t('settings.openchamber.defaults.smallModel.useDefault')}
              ariaLabel={t('settings.openchamber.defaults.smallModel.useDefaultAria')}
            />

            {!smallModelUseDefault ? (
              <SettingsFieldRow label={t('settings.openchamber.defaults.smallModel.overrideModel')}>
                <ModelSelector
                  providerId={parsedSmallModel.providerId}
                  modelId={parsedSmallModel.modelId}
                  onChange={handleSmallModelOverrideChange}
                  allowedProviderIds={smallModelProviders}
                  className={SETTINGS_CUSTOM_TRIGGER_CLASS}
                />
              </SettingsFieldRow>
            ) : null}

            <SettingsInset className={SETTINGS_OPTION_STACK_CLASS}>
              <div className="flex items-center gap-1.5">
                <SettingsGroupTitle>
                  {t('settings.openchamber.defaults.walkthroughModel.title')}
                </SettingsGroupTitle>
                <SettingsInfoHint>
                  {t('settings.openchamber.defaults.walkthroughModel.description')}
                </SettingsInfoHint>
              </div>

              <SettingsFieldRow
                settingsItem="sessions.walkthrough-model"
                label={t('settings.openchamber.defaults.walkthroughModel.overrideModel')}
              >
                <ModelSelector
                  providerId={parsedWalkthroughModel.providerId}
                  modelId={parsedWalkthroughModel.modelId}
                  onChange={handleWalkthroughModelOverrideChange}
                  allowedProviderIds={smallModelProviders}
                  isModelAllowed={isStructuredOutputCapable}
                  placeholder={t('settings.openchamber.defaults.walkthroughModel.usesSmallModel')}
                  className={SETTINGS_CUSTOM_TRIGGER_CLASS}
                />
              </SettingsFieldRow>
            </SettingsInset>
          </div>
        </div>
      </SettingsSection>
    </>
  );
};
