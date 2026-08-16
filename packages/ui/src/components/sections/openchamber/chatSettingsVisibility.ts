import { isSessionGoalVisibleOnPiKernel } from '@/lib/usePiKernel';

export type ChatKernelSetting = 'sessionGoal' | 'sessionAssist';

/**
 * Kernel-specific Settings Chat groups. Session Goal is a Pichamber feature
 * and stays on Pi. Session Assist remains OpenCode-only.
 */
export function chatKernelSettings(isPiKernel: boolean): ChatKernelSetting[] {
  return [
    ...(isSessionGoalVisibleOnPiKernel(isPiKernel) ? ['sessionGoal' as const] : []),
    ...(!isPiKernel ? ['sessionAssist' as const] : []),
  ];
}
