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
  levels: string[];
  pinGeneration: number;
  pinKey: string;
  setLevel: (level: string | undefined, hasLevels?: boolean, levels?: readonly string[]) => void;
  bumpPin: (key: string) => void;
}

export const usePiThinkingChipStore = create<PiThinkingChipStore>((set) => ({
  level: undefined,
  hasLevels: false,
  levels: [],
  pinGeneration: 0,
  pinKey: '',
  setLevel: (level, hasLevels, levels) => set((state) => ({
    level,
    hasLevels: hasLevels ?? state.hasLevels,
    levels: levels ? [...levels] : state.levels,
  })),
  bumpPin: (key) => set((state) => ({
    pinGeneration: state.pinGeneration + 1,
    pinKey: typeof key === 'string' ? key : state.pinKey,
  })),
}));
