import React from 'react';
import {
  SettingsChipGroup,
  SettingsSection,
  SettingsStackedField,
  SETTINGS_FIELDS_STACK_CLASS,
  SETTINGS_FIELD_LABEL_CLASS,
  SETTINGS_HELPER_CLASS,
  SETTINGS_ICON_BUTTON_CLASS,
  SETTINGS_CONTROL_CLUSTER_CLASS,
  SETTINGS_NUMBER_STEPPER_ROW_CLASS,
  SETTINGS_NUMBER_UNIT_CLASS,
} from '@/components/sections/shared/SettingsSection';
import { SettingsInfoHint } from '@/components/sections/shared/SettingsInfoHint';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NumberInput } from '@/components/ui/number-input';
import { Icon } from '@/components/icon/Icon';
import { catalogEntriesFromMetadataMap } from '@/lib/model-catalog-capabilities';
import { useI18n } from '@/lib/i18n';
import { toast } from '@/components/ui';
import { runtimeFetch } from '@/lib/runtime-fetch';
import { useConfigStore } from '@/stores/useConfigStore';
import {
  addRemoteModelsToForm,
  applyModelContextChange,
  applyModelIdChange,
  buildFetchRemoteModelsRequest,
  createEmptyCustomProviderForm,
  createHeaderRow,
  createModelRow,
  fetchRemoteModelsErrorKey,
  isInferredModelContext,
  parseRemoteProviderModelsPayload,
  prepareRemoteModelPicker,
  remoteModelAlreadyAdded,
  validateCustomProvider,
  type RemoteModelFamily,
  type CustomProviderFormState,
  type CustomProviderPersistPlan,
  type CustomProviderTranslator,
  type FieldErrors,
  type HeaderFieldErrors,
  type ModelFieldErrors,
  type RemoteProviderModel,
} from './custom-provider-form';

type CustomProviderFormProps = {
  existingProviderIDs: ReadonlySet<string>;
  disabledProviders?: readonly string[];
  busy?: boolean;
  mode?: 'create' | 'edit';
  initialValues?: CustomProviderFormState;
  allowExistingAuth?: boolean;
  authFailureHint?: string | null;
  onSubmit: (plan: CustomProviderPersistPlan) => void | Promise<void>;
  onCancel?: () => void;
  onDisconnect?: () => void | Promise<void>;
};

export const CustomProviderForm: React.FC<CustomProviderFormProps> = ({
  existingProviderIDs,
  disabledProviders = [],
  busy = false,
  mode = 'create',
  initialValues,
  allowExistingAuth = false,
  authFailureHint = null,
  onSubmit,
  onCancel,
  onDisconnect,
}) => {
  const { t } = useI18n();
  const modelsMetadata = useConfigStore((state) => state.modelsMetadata);
  const catalog = React.useMemo(
    () => catalogEntriesFromMetadataMap(modelsMetadata),
    [modelsMetadata],
  );
  const isEdit = mode === 'edit';
  const [form, setForm] = React.useState<CustomProviderFormState>(
    () => initialValues ?? createEmptyCustomProviderForm(),
  );
  const [err, setErr] = React.useState<FieldErrors>({});
  const [modelErrors, setModelErrors] = React.useState<ModelFieldErrors[]>([]);
  const [headerErrors, setHeaderErrors] = React.useState<HeaderFieldErrors[]>([]);
  const [fetchingModels, setFetchingModels] = React.useState(false);
  const [remoteModels, setRemoteModels] = React.useState<RemoteProviderModel[] | null>(null);
  const [remotePickerOpen, setRemotePickerOpen] = React.useState(false);
  const [remoteModelQuery, setRemoteModelQuery] = React.useState('');
  const [remoteModelFamily, setRemoteModelFamily] = React.useState<RemoteModelFamily>('all');
  const seededEditProviderIdRef = React.useRef<string | null>(null);
  const fetchAbortRef = React.useRef<AbortController | null>(null);
  const lastFetchFingerprintRef = React.useRef('');
  const remotePicker = React.useMemo(
    () => (remoteModels
      ? prepareRemoteModelPicker(remoteModels, remoteModelQuery, remoteModelFamily)
      : null),
    [remoteModels, remoteModelQuery, remoteModelFamily],
  );
  const remoteFamilyOptions = React.useMemo(() => {
    const countKeys: Record<Exclude<RemoteModelFamily, 'all'>, Parameters<typeof t>[0]> = {
      cc: 'settings.providers.page.custom.models.picker.family.ccCount',
      gpt: 'settings.providers.page.custom.models.picker.family.gptCount',
      grok: 'settings.providers.page.custom.models.picker.family.grokCount',
      ds: 'settings.providers.page.custom.models.picker.family.dsCount',
      other: 'settings.providers.page.custom.models.picker.family.otherCount',
    };
    const options: Array<{ value: RemoteModelFamily; label: string }> = [
      { value: 'all', label: t('settings.providers.page.custom.models.picker.family.all') },
    ];
    (Object.keys(countKeys) as Array<Exclude<RemoteModelFamily, 'all'>>).forEach((family) => {
      const count = remotePicker?.familyCounts[family] ?? 0;
      if (family !== remoteModelFamily && count === 0) {
        return;
      }
      options.push({
        value: family,
        label: t(countKeys[family], { count }),
      });
    });
    return options;
  }, [remoteModelFamily, remotePicker, t]);

  React.useEffect(() => () => {
    fetchAbortRef.current?.abort();
  }, []);

  React.useEffect(() => {
    setRemoteModels(null);
    setRemotePickerOpen(false);
    setRemoteModelQuery('');
    setRemoteModelFamily('all');
    lastFetchFingerprintRef.current = '';
  }, [form.baseURL, form.providerID]);

  React.useEffect(() => {
    if (!initialValues) {
      return;
    }
    // Edit mode: seed once per provider id so parent re-renders (new object
    // identity for the same snapshot) do not wipe in-progress edits.
    if (isEdit && seededEditProviderIdRef.current === initialValues.providerID) {
      return;
    }
    seededEditProviderIdRef.current = isEdit ? initialValues.providerID : null;
    setForm(initialValues);
    setErr({});
    setModelErrors([]);
    setHeaderErrors([]);
  }, [initialValues, isEdit]);

  const setField = (key: keyof Pick<CustomProviderFormState, 'providerID' | 'name' | 'baseURL' | 'apiKey'>, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setErr((prev) => ({ ...prev, [key]: undefined }));
  };

  const setModel = (index: number, key: 'id' | 'name', value: string) => {
    setForm((prev) => ({
      ...prev,
      models: prev.models.map((row, rowIndex) => {
        if (rowIndex !== index) {
          return row;
        }
        return key === 'id' ? applyModelIdChange(row, value) : { ...row, [key]: value };
      }),
    }));
    setModelErrors((prev) => {
      const next = [...prev];
      next[index] = { ...(next[index] ?? {}), [key]: undefined };
      return next;
    });
  };

  const setModelContext = (index: number, contextWindow: number | undefined) => {
    setForm((prev) => ({
      ...prev,
      models: prev.models.map((row, rowIndex) => (
        rowIndex === index ? applyModelContextChange(row, contextWindow) : row
      )),
    }));
  };

  const setHeader = (index: number, key: 'key' | 'value', value: string) => {
    setForm((prev) => ({
      ...prev,
      headers: prev.headers.map((row, rowIndex) => (rowIndex === index ? { ...row, [key]: value } : row)),
    }));
    setHeaderErrors((prev) => {
      const next = [...prev];
      next[index] = { ...(next[index] ?? {}), [key]: undefined };
      return next;
    });
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) {
      return;
    }

    const output = validateCustomProvider({
      form,
      t: ((key, vars) => t(key as Parameters<typeof t>[0], vars)) as CustomProviderTranslator,
      existingProviderIDs,
      disabledProviders,
      editingProviderID: isEdit ? form.providerID : undefined,
      allowExistingAuth: isEdit && allowExistingAuth,
      catalog,
    });
    setErr(output.err);
    setModelErrors(output.models);
    setHeaderErrors(output.headers);
    if (!output.result) {
      return;
    }
    await onSubmit(output.result);
  };

  const remoteFetchFingerprint = () => (
    `${form.baseURL.trim()}\n${form.apiKey.trim()}\n${form.providerID.trim()}`
  );

  const handleFetchModels = async () => {
    if (busy) {
      return;
    }
    if (fetchingModels) {
      fetchAbortRef.current?.abort();
      return;
    }
    const fingerprint = remoteFetchFingerprint();
    if (
      remoteModels
      && remoteModels.length > 0
      && !remotePickerOpen
      && lastFetchFingerprintRef.current === fingerprint
    ) {
      setRemotePickerOpen(true);
      return;
    }
    const built = buildFetchRemoteModelsRequest(form, {
      allowExistingAuth: isEdit && allowExistingAuth,
      editingProviderID: isEdit ? form.providerID : undefined,
    });
    if ('errorKey' in built) {
      toast.error(t(built.errorKey as Parameters<typeof t>[0]));
      return;
    }

    fetchAbortRef.current?.abort();
    const abort = new AbortController();
    fetchAbortRef.current = abort;
    setFetchingModels(true);
    try {
      const response = await runtimeFetch('/api/provider/models', {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(built.request),
        signal: abort.signal,
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        const code = payload && typeof payload === 'object' && typeof payload.error === 'string'
          ? payload.error
          : undefined;
        throw new Error(t(fetchRemoteModelsErrorKey(response.status, code) as Parameters<typeof t>[0]));
      }
      const models = parseRemoteProviderModelsPayload(payload);
      if (!models) {
        throw new Error(t('settings.providers.page.custom.error.fetch.failed'));
      }
      if (models.length === 0) {
        toast.error(t('settings.providers.page.custom.toast.modelsEmpty'));
        setRemoteModels(null);
        setRemotePickerOpen(false);
        return;
      }
      if (prepareRemoteModelPicker(models).uniqueCount === 0) {
        toast.error(t('settings.providers.page.custom.toast.modelsNoneAddable'));
        setRemoteModels(null);
        setRemotePickerOpen(false);
        return;
      }
      lastFetchFingerprintRef.current = fingerprint;
      setRemoteModelQuery('');
      setRemoteModelFamily('all');
      setRemoteModels(models);
      setRemotePickerOpen(true);
    } catch (error) {
      if (abort.signal.aborted || (error instanceof DOMException && error.name === 'AbortError')) {
        return;
      }
      toast.error(
        error instanceof Error && error.message
          ? error.message
          : t('settings.providers.page.custom.error.fetch.failed'),
      );
    } finally {
      if (fetchAbortRef.current === abort) {
        setFetchingModels(false);
      }
    }
  };

  const addRemoteModel = (model: RemoteProviderModel) => {
    setForm((prev) => ({
      ...prev,
      models: addRemoteModelsToForm(prev.models, [model]),
    }));
    setModelErrors([]);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-0">
      <SettingsSection
        title={isEdit ? t('settings.providers.page.custom.editTitle') : t('settings.providers.page.custom.title')}
        divider={false}
        settingsItem="providers.custom"
        contentClassName={SETTINGS_FIELDS_STACK_CLASS}
      >
        <p className={SETTINGS_HELPER_CLASS}>{t('settings.providers.page.custom.description')}</p>

        {authFailureHint ? (
          <p className="typography-meta text-[var(--status-warning)]" role="status">
            {authFailureHint}
          </p>
        ) : null}

        <SettingsStackedField
          label={t('settings.providers.page.custom.field.providerID.label')}
          info={t('settings.providers.page.custom.field.providerID.info')}
        >
          <Input
            value={form.providerID}
            onChange={(event) => setField('providerID', event.target.value)}
            placeholder={t('settings.providers.page.custom.field.providerID.placeholder')}
            className="h-8 rounded-md px-3 font-mono text-xs"
            autoFocus={!isEdit}
            disabled={isEdit || busy}
            aria-invalid={Boolean(err.providerID)}
            aria-label={t('settings.providers.page.custom.field.providerID.label')}
          />
          {err.providerID ? <p className="mt-1 typography-meta text-[var(--status-error)]">{err.providerID}</p> : null}
        </SettingsStackedField>

        <SettingsStackedField
          label={t('settings.providers.page.custom.field.name.label')}
          info={t('settings.providers.page.custom.field.name.info')}
        >
          <Input
            value={form.name}
            onChange={(event) => setField('name', event.target.value)}
            placeholder={t('settings.providers.page.custom.field.name.placeholder')}
            className="h-8 rounded-md px-3"
            aria-invalid={Boolean(err.name)}
            aria-label={t('settings.providers.page.custom.field.name.label')}
          />
          {err.name ? <p className="mt-1 typography-meta text-[var(--status-error)]">{err.name}</p> : null}
        </SettingsStackedField>

        <SettingsStackedField
          label={t('settings.providers.page.custom.field.baseURL.label')}
          info={t('settings.providers.page.custom.field.baseURL.info')}
        >
          <Input
            value={form.baseURL}
            onChange={(event) => setField('baseURL', event.target.value)}
            placeholder={t('settings.providers.page.custom.field.baseURL.placeholder')}
            className="h-8 rounded-md px-3 font-mono text-xs"
            aria-invalid={Boolean(err.baseURL)}
            aria-label={t('settings.providers.page.custom.field.baseURL.label')}
          />
          {err.baseURL ? <p className="mt-1 typography-meta text-[var(--status-error)]">{err.baseURL}</p> : null}
        </SettingsStackedField>

        <SettingsStackedField
          label={t('settings.providers.page.custom.field.apiKey.label')}
          info={
            isEdit && allowExistingAuth
              ? t('settings.providers.page.custom.field.apiKey.editInfo')
              : t('settings.providers.page.custom.field.apiKey.info')
          }
        >
          <Input
            type="password"
            value={form.apiKey}
            onChange={(event) => setField('apiKey', event.target.value)}
            placeholder={
              isEdit && allowExistingAuth
                ? t('settings.providers.page.custom.field.apiKey.editPlaceholder')
                : t('settings.providers.page.custom.field.apiKey.placeholder')
            }
            className="h-8 rounded-md px-3 font-mono text-xs"
            aria-invalid={Boolean(err.apiKey)}
            aria-label={t('settings.providers.page.custom.field.apiKey.label')}
          />
          {err.apiKey ? <p className="mt-1 typography-meta text-[var(--status-error)]">{err.apiKey}</p> : null}
        </SettingsStackedField>
      </SettingsSection>

      <SettingsSection
        title={t('settings.providers.page.custom.models.title')}
        info={t('settings.providers.page.custom.models.fetchInfo')}
        contentClassName={SETTINGS_FIELDS_STACK_CLASS}
      >
        {form.models.map((model, index) => (
          <div key={model.row} className={`${SETTINGS_CONTROL_CLUSTER_CLASS} space-y-2`}>
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1 space-y-2">
                <div>
                  <label className={SETTINGS_FIELD_LABEL_CLASS}>
                    {t('settings.providers.page.custom.models.idLabel')}
                  </label>
                  <Input
                    value={model.id}
                    onChange={(event) => setModel(index, 'id', event.target.value)}
                    placeholder={t('settings.providers.page.custom.models.idPlaceholder')}
                    className="mt-1 h-8 rounded-md px-3 font-mono text-xs"
                    aria-label={t('settings.providers.page.custom.models.idLabel')}
                  />
                  {modelErrors[index]?.id ? (
                    <p className="mt-1 typography-meta text-[var(--status-error)]">{modelErrors[index]?.id}</p>
                  ) : null}
                </div>
                <div>
                  <label className={SETTINGS_FIELD_LABEL_CLASS}>
                    {t('settings.providers.page.custom.models.nameLabel')}
                  </label>
                  <Input
                    value={model.name}
                    onChange={(event) => setModel(index, 'name', event.target.value)}
                    placeholder={t('settings.providers.page.custom.models.namePlaceholder')}
                    className="mt-1 h-8 rounded-md px-3"
                    aria-label={t('settings.providers.page.custom.models.nameLabel')}
                  />
                  {modelErrors[index]?.name ? (
                    <p className="mt-1 typography-meta text-[var(--status-error)]">{modelErrors[index]?.name}</p>
                  ) : null}
                </div>
                <div>
                  <div className="flex items-center gap-1">
                    <label className={SETTINGS_FIELD_LABEL_CLASS}>
                      {t('settings.providers.page.custom.models.contextLabel')}
                    </label>
                    <SettingsInfoHint>
                      {t('settings.providers.page.custom.models.contextInfo')}
                    </SettingsInfoHint>
                  </div>
                  <div className={`${SETTINGS_NUMBER_STEPPER_ROW_CLASS} mt-1`}>
                    <NumberInput
                      value={model.contextWindow}
                      onValueChange={(value) => setModelContext(index, value)}
                      onClear={() => setModelContext(index, undefined)}
                      min={1}
                      step={1000}
                      inputMode="numeric"
                      placeholder="—"
                      emptyLabel="—"
                      className="w-24 tabular-nums"
                      aria-label={t('settings.providers.page.custom.models.contextAria')}
                    />
                    <span className={SETTINGS_NUMBER_UNIT_CLASS}>
                      {t('settings.providers.page.custom.models.contextUnit')}
                    </span>
                  </div>
                  {isInferredModelContext(model) ? (
                    <p className={`mt-1 ${SETTINGS_HELPER_CLASS}`}>
                      {t('settings.providers.page.custom.models.contextInferred')}
                    </p>
                  ) : null}
                </div>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className={SETTINGS_ICON_BUTTON_CLASS}
                disabled={form.models.length <= 1}
                onClick={() => {
                  if (form.models.length <= 1) return;
                  setForm((prev) => ({
                    ...prev,
                    models: prev.models.filter((_, rowIndex) => rowIndex !== index),
                  }));
                  setModelErrors((prev) => prev.filter((_, rowIndex) => rowIndex !== index));
                }}
                aria-label={t('settings.providers.page.custom.models.remove')}
              >
                <Icon name="delete-bin" className="size-4" />
              </Button>
            </div>
          </div>
        ))}
        <div className={`${SETTINGS_CONTROL_CLUSTER_CLASS} flex flex-wrap items-center gap-2`} data-settings-item="providers.custom.fetchModels">
          <Button
            type="button"
            variant="outline"
            size="xs"
            className="!font-normal"
            onClick={() => void handleFetchModels()}
            disabled={busy}
            aria-busy={fetchingModels}
            aria-label={
              fetchingModels
                ? t('settings.providers.page.custom.models.fetchCancel')
                : t('settings.providers.page.custom.models.fetch')
            }
          >
            <Icon name="download" className="size-3.5" />
            {fetchingModels
              ? t('settings.providers.page.custom.models.fetchCancel')
              : t('settings.providers.page.custom.models.fetch')}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="xs"
            className="!font-normal"
            disabled={busy}
            onClick={() => {
              setForm((prev) => ({ ...prev, models: [...prev.models, createModelRow()] }));
              setModelErrors((prev) => [...prev, {}]);
            }}
          >
            {t('settings.providers.page.custom.models.add')}
          </Button>
        </div>
        {remotePickerOpen && remoteModels ? (
          <div
            className="space-y-3"
            role="region"
            aria-label={t('settings.providers.page.custom.models.picker.region')}
          >
            <div>
              <p className={SETTINGS_FIELD_LABEL_CLASS}>
                {t('settings.providers.page.custom.models.picker.title')}
              </p>
              <p className={SETTINGS_HELPER_CLASS}>
                {remotePicker && remotePicker.uniqueCount < remotePicker.fetchedCount
                  ? t('settings.providers.page.custom.models.picker.descriptionCollapsed', {
                      shown: String(remotePicker.uniqueCount),
                      count: String(remotePicker.fetchedCount),
                    })
                  : t('settings.providers.page.custom.models.picker.description', {
                      count: remotePicker?.fetchedCount ?? remoteModels.length,
                    })}
              </p>
            </div>
            <SettingsChipGroup
              value={remoteModelFamily}
              onChange={setRemoteModelFamily}
              aria-label={t('settings.providers.page.custom.models.picker.family.label')}
              options={remoteFamilyOptions}
            />
            <Input
              value={remoteModelQuery}
              onChange={(event) => setRemoteModelQuery(event.target.value)}
              placeholder={t('settings.providers.page.custom.models.picker.search')}
              className="h-8 rounded-md px-3"
              aria-label={t('settings.providers.page.custom.models.picker.search')}
            />
            <div className="min-h-0 max-h-64 overflow-y-auto" role="list">
              {!remotePicker || remotePicker.choices.length === 0 ? (
                <p className="typography-meta text-muted-foreground py-3">
                  {remoteModelQuery.trim()
                    ? t('settings.providers.page.custom.models.picker.empty')
                    : t('settings.providers.page.custom.models.picker.familyEmpty')}
                </p>
              ) : (
                remotePicker.choices.map((model) => {
                  const added = remoteModelAlreadyAdded(form.models, model.id);
                  return (
                    <div
                      key={model.id}
                      role="listitem"
                      className="flex items-center gap-2 py-1.5"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="typography-ui-label truncate">{model.name}</p>
                        {model.name !== model.id ? (
                          <p className="typography-meta font-mono text-muted-foreground truncate">{model.id}</p>
                        ) : null}
                        {model.aliases.length > 0 ? (
                          <p className="typography-meta text-muted-foreground truncate">
                            {t('settings.providers.page.custom.models.picker.aliases', {
                              count: String(model.aliases.length),
                            })}
                          </p>
                        ) : null}
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="xs"
                        className="!font-normal shrink-0"
                        disabled={added}
                        onClick={() => addRemoteModel(model)}
                        aria-label={
                          added
                            ? t('settings.providers.page.custom.models.picker.added')
                            : t('settings.providers.page.custom.models.picker.addAria', { name: model.name })
                        }
                      >
                        {added
                          ? t('settings.providers.page.custom.models.picker.added')
                          : t('settings.providers.page.custom.models.picker.add')}
                      </Button>
                    </div>
                  );
                })
              )}
            </div>
            <Button
              type="button"
              variant="outline"
              size="xs"
              className="!font-normal"
              onClick={() => setRemotePickerOpen(false)}
            >
              {t('settings.providers.page.custom.models.picker.done')}
            </Button>
          </div>
        ) : null}
      </SettingsSection>

      <SettingsSection
        title={t('settings.providers.page.custom.headers.title')}
        contentClassName={SETTINGS_FIELDS_STACK_CLASS}
      >
        <p className={SETTINGS_HELPER_CLASS}>{t('settings.providers.page.custom.headers.description')}</p>
        {form.headers.map((header, index) => (
          <div key={header.row} className={`${SETTINGS_CONTROL_CLUSTER_CLASS} space-y-2`}>
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1 space-y-2">
                <div>
                  <label className={SETTINGS_FIELD_LABEL_CLASS}>
                    {t('settings.providers.page.custom.headers.keyLabel')}
                  </label>
                  <Input
                    value={header.key}
                    onChange={(event) => setHeader(index, 'key', event.target.value)}
                    placeholder={t('settings.providers.page.custom.headers.keyPlaceholder')}
                    className="mt-1 h-8 rounded-md px-3 font-mono text-xs"
                    aria-label={t('settings.providers.page.custom.headers.keyLabel')}
                  />
                  {headerErrors[index]?.key ? (
                    <p className="mt-1 typography-meta text-[var(--status-error)]">{headerErrors[index]?.key}</p>
                  ) : null}
                </div>
                <div>
                  <label className={SETTINGS_FIELD_LABEL_CLASS}>
                    {t('settings.providers.page.custom.headers.valueLabel')}
                  </label>
                  <Input
                    value={header.value}
                    onChange={(event) => setHeader(index, 'value', event.target.value)}
                    placeholder={t('settings.providers.page.custom.headers.valuePlaceholder')}
                    className="mt-1 h-8 rounded-md px-3 font-mono text-xs"
                    aria-label={t('settings.providers.page.custom.headers.valueLabel')}
                  />
                  {headerErrors[index]?.value ? (
                    <p className="mt-1 typography-meta text-[var(--status-error)]">{headerErrors[index]?.value}</p>
                  ) : null}
                </div>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className={SETTINGS_ICON_BUTTON_CLASS}
                disabled={form.headers.length <= 1}
                onClick={() => {
                  if (form.headers.length <= 1) return;
                  setForm((prev) => ({
                    ...prev,
                    headers: prev.headers.filter((_, rowIndex) => rowIndex !== index),
                  }));
                  setHeaderErrors((prev) => prev.filter((_, rowIndex) => rowIndex !== index));
                }}
                aria-label={t('settings.providers.page.custom.headers.remove')}
              >
                <Icon name="delete-bin" className="size-4" />
              </Button>
            </div>
          </div>
        ))}
        <Button
          type="button"
          variant="outline"
          size="xs"
          className="!font-normal"
          onClick={() => {
            setForm((prev) => ({ ...prev, headers: [...prev.headers, createHeaderRow()] }));
            setHeaderErrors((prev) => [...prev, {}]);
          }}
        >
          {t('settings.providers.page.custom.headers.add')}
        </Button>
      </SettingsSection>

      <div className="flex flex-wrap items-center gap-2 py-4">
        {onCancel ? (
          <Button type="button" variant="outline" size="xs" className="!font-normal" onClick={onCancel} disabled={busy}>
            {t('settings.providers.page.custom.actions.back')}
          </Button>
        ) : null}
        {onDisconnect ? (
          <Button
            type="button"
            variant="destructive"
            size="xs"
            className="!font-normal"
            onClick={() => void onDisconnect()}
            disabled={busy}
          >
            {t('settings.providers.page.actions.disconnect')}
          </Button>
        ) : null}
        <Button type="submit" size="xs" className="!font-normal" disabled={busy}>
          {busy
            ? t('settings.providers.page.actions.saving')
            : isEdit
              ? t('settings.providers.page.custom.actions.update')
              : t('settings.providers.page.custom.actions.save')}
        </Button>
      </div>
    </form>
  );
};
