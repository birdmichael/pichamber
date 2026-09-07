import React from 'react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { dropdownTriggerVariants } from '@/components/ui/dropdown-trigger';
import { toast } from '@/components/ui';
import { Icon } from '@/components/icon/Icon';
import { usePiPlanChrome } from '@/hooks/usePiPlanChrome';
import { useI18n } from '@/lib/i18n';
import { getProviderModelRefDisplayName } from '@/lib/modelDisplay';
import { cn } from '@/lib/utils';
import { runtimeFetch } from '@/lib/runtime-fetch';
import { useConfigStore } from '@/stores/useConfigStore';
import { useSelectionStore } from '@/sync/selection-store';
import { dispatchSessionPlanAction } from '@/sync/pi-session-plan-store';

type ModelOption = {
  providerID: string;
  modelID: string;
  label: string;
};

export function PiPlanBuildRow({ className }: { className?: string }) {
  const { t } = useI18n();
  const chrome = usePiPlanChrome();
  const providers = useConfigStore((state) => state.providers);
  const currentProviderId = useConfigStore((state) => state.currentProviderId);
  const currentModelId = useConfigStore((state) => state.currentModelId);
  const setProvider = useConfigStore((state) => state.setProvider);
  const setModel = useConfigStore((state) => state.setModel);
  const saveSessionModelSelection = useSelectionStore((state) => state.saveSessionModelSelection);
  const [picked, setPicked] = React.useState<ModelOption | null>(null);
  const [pending, setPending] = React.useState(false);

  const models = React.useMemo<ModelOption[]>(() => {
    return providers.flatMap((provider) => {
      const providerID = typeof provider?.id === 'string' ? provider.id : '';
      if (!providerID) return [];
      const list = Array.isArray(provider.models) ? provider.models : [];
      return list.flatMap((model) => {
        const modelID = typeof model?.id === 'string' ? model.id : '';
        if (!modelID) return [];
        const modelName = typeof model?.name === 'string' && model.name.trim() ? model.name : undefined;
        const label = getProviderModelRefDisplayName(providerID, modelID, {
          providerName: provider.name,
          modelName,
        });
        return [{ providerID, modelID, label }];
      });
    });
  }, [providers]);

  const selected = picked
    ?? models.find((model) => model.providerID === currentProviderId && model.modelID === currentModelId)
    ?? models[0]
    ?? null;

  if (!chrome.showBuildRow && !chrome.implementing) return null;
  if (!chrome.available) return null;

  const selectModel = (model: ModelOption) => {
    setPicked(model);
    // Keep Plan Build on the same session selection path as the main composer.
    // This updates the chip immediately; the request below makes the Pi session
    // authoritative before Build starts.
    setProvider(model.providerID);
    setModel(model.modelID);
    if (chrome.sessionID) {
      saveSessionModelSelection(chrome.sessionID, model.providerID, model.modelID);
      void runtimeFetch(`/api/session/${encodeURIComponent(chrome.sessionID)}/model`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: `${model.providerID}/${model.modelID}` }),
      }).catch(() => undefined);
    }
  };

  if (chrome.implementing) {
    return (
      <div className={cn('flex items-center gap-2 min-w-0', className)}>
        <Button type="button" size="sm" disabled>
          {t('chat.piPlan.building')}
          {selected ? ` · ${selected.label}` : ''}
        </Button>
      </div>
    );
  }

  const disabled = chrome.buildDisabled || pending || !chrome.sessionID || !selected;

  const build = async () => {
    if (!chrome.sessionID || !selected) return;
    setPending(true);
    try {
      const pickedRef = `${selected.providerID}/${selected.modelID}`;
      const next = await dispatchSessionPlanAction(chrome.sessionID, 'implement', {
        // Always send the Build choice, even when another update has not yet
        // reached the session model endpoint.
        model: pickedRef,
      });
      if (!next) {
        toast.error(t('chat.piPlan.buildFailed'));
      }
    } finally {
      setPending(false);
    }
  };

  return (
    <div className={cn('flex items-center gap-2 min-w-0', className)}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className={cn(dropdownTriggerVariants({ size: 'sm' }), 'max-w-[220px] min-w-0')}
            disabled={disabled}
            aria-label={t('chat.piPlan.buildModelAria')}
          >
            <span className="truncate">{selected?.label || t('chat.modelControls.selectModel')}</span>
            <Icon name="arrow-down-s" className="size-3.5" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-h-72 overflow-auto">
          {models.map((model) => {
            const key = `${model.providerID}/${model.modelID}`;
            const isSelected = selected?.providerID === model.providerID && selected?.modelID === model.modelID;
            return (
              <DropdownMenuItem
                key={key}
                onClick={() => selectModel(model)}
                aria-checked={isSelected}
              >
                {model.label}
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>
      <Button
        type="button"
        size="sm"
        disabled={disabled}
        // Block focus transfer so tapping Build on the pill does not expand
        // or collapse the composer. onClick still fires.
        onMouseDown={(event) => event.preventDefault()}
        onPointerDownCapture={(event) => {
          if (event.pointerType === 'touch') event.preventDefault();
        }}
        onClick={() => void build()}
      >
        {t('chat.piPlan.build')}
      </Button>
    </div>
  );
}
