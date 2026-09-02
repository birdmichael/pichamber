import { create } from 'zustand';

/**
 * Live Pi thinking level for the mobile composer chip.
 *
 * ModelControls owns the fetch and PATCH. The expanded mobile chip row
 * cannot reuse that instance (it stays a hidden sheet host), so this
 * store is the one shared label.
 */
interface PiThinkingChipStore {
  level: string | undefined;
  hasLevels: boolean;
  setLevel: (level: string | undefined, hasLevels?: boolean) => void;
}

export const usePiThinkingChipStore = create<PiThinkingChipStore>((set) => ({
  level: undefined,
  hasLevels: false,
  setLevel: (level, hasLevels) => set(
    hasLevels === undefined ? { level } : { level, hasLevels },
  ),
}));
