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
import { cn } from '@/lib/utils';
import { useConfigStore } from '@/stores/useConfigStore';
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
        const name = typeof model?.name === 'string' && model.name.trim() ? model.name : modelID;
        return [{ providerID, modelID, label: name }];
      });
    });
  }, [providers]);

  const selected = picked
    ?? models.find((model) => model.providerID === currentProviderId && model.modelID === currentModelId)
    ?? models[0]
    ?? null;

  if (!chrome.showBuildRow && !chrome.implementing) return null;
  if (!chrome.available) return null;

  if (chrome.implementing) {
    return (
      <div className={cn('flex items-center gap-2 min-w-0', className)}>
        <Button type="button" size="sm" disabled>
          {t('chat.piPlan.building')}
        </Button>
      </div>
    );
  }

  const disabled = chrome.buildDisabled || pending || !chrome.sessionID || !selected;

  const build = async () => {
    if (!chrome.sessionID || !selected) return;
    setPending(true);
    try {
      const currentRef = currentProviderId && currentModelId
        ? `${currentProviderId}/${currentModelId}`
        : '';
      const pickedRef = `${selected.providerID}/${selected.modelID}`;
      const next = await dispatchSessionPlanAction(chrome.sessionID, 'implement', {
        model: pickedRef !== currentRef ? pickedRef : undefined,
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
                onClick={() => setPicked(model)}
                aria-checked={isSelected}
              >
                {model.label}
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>
      <Button type="button" size="sm" disabled={disabled} onClick={() => void build()}>
        {t('chat.piPlan.build')}
      </Button>
    </div>
  );
}
