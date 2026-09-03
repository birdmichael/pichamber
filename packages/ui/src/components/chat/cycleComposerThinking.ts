import { runtimeFetch } from '@/lib/runtime-fetch';
import { useConfigStore } from '@/stores/useConfigStore';
import { useSelectionStore } from '@/sync/selection-store';
import { useSessionUIStore } from '@/sync/session-ui-store';
import {
  parseAvailablePiThinkingLevels,
  parsePiThinkingLevel,
  nextCycledPiThinkingLevel,
  resolvePairedPiThinking,
} from './piThinking';
import { usePiThinkingChipStore } from './piThinkingChipStore';

export function composerThinkingPinKey(
  sessionId: string | null | undefined,
  providerId: string | null | undefined,
  modelId: string | null | undefined,
): string {
  return `${sessionId ?? ''}|${providerId ?? ''}|${modelId ?? ''}`;
}

let applyComposerThinkingChain: Promise<void> = Promise.resolve();

export async function applyComposerThinking(
  level: string,
  options?: { levels?: readonly string[]; pinKey?: string },
): Promise<void> {
  const sessionId = useSessionUIStore.getState().currentSessionId;
  const { currentProviderId, currentModelId } = useConfigStore.getState();
  const chip = usePiThinkingChipStore.getState();
  const pinKey = options?.pinKey ?? composerThinkingPinKey(sessionId, currentProviderId, currentModelId);
  const catalogLevels = options?.levels ?? chip.levels;
  chip.setLevel(level, true, catalogLevels);
  chip.bumpPin(pinKey);
  const run = applyComposerThinkingChain.then(async () => {
    try {
      if (!sessionId) {
        return;
      }
      const res = await runtimeFetch(`/api/session/${encodeURIComponent(sessionId)}/thinking`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ thinking: level }),
      });
      if (!res?.ok) {
        return;
      }
      const payload = await res.json().catch(() => null);
      const applied = parsePiThinkingLevel(payload?.thinking);
      if (!applied) {
        return;
      }
      const later = usePiThinkingChipStore.getState();
      if (later.pinKey !== pinKey) {
        return;
      }
      const pair = resolvePairedPiThinking({
        current: applied,
        catalogLevels,
        liveAvailable: parseAvailablePiThinkingLevels(payload?.available),
      });
      later.setLevel(
        pair.thinking ?? applied,
        true,
        pair.levels.length > 0 ? pair.levels : catalogLevels,
      );
      later.bumpPin(pinKey);
    } catch {
      // keep the optimistic chip; Settings → Sessions remains the fallback
    }
  });
  applyComposerThinkingChain = run.then(() => undefined, () => undefined);
  await run;
}

export function cycleComposerThinking(isPiKernel: boolean): boolean {
  if (isPiKernel) {
    const chip = usePiThinkingChipStore.getState();
    const next = nextCycledPiThinkingLevel(chip.level, chip.levels);
    if (!next) return false;
    void applyComposerThinking(next, { levels: chip.levels });
    return true;
  }

  const config = useConfigStore.getState();
  if (config.getCurrentModelVariants().length === 0) return false;
  config.cycleCurrentVariant();
  const sessionId = useSessionUIStore.getState().currentSessionId;
  const { currentAgentName, currentProviderId, currentModelId, currentVariant } = useConfigStore.getState();
  if (sessionId && currentAgentName && currentProviderId && currentModelId) {
    useSelectionStore.getState().saveAgentModelVariantForSession(
      sessionId,
      currentAgentName,
      currentProviderId,
      currentModelId,
      currentVariant,
    );
  }
  return true;
}
