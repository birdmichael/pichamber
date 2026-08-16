import { isSessionGoalVisibleOnPiKernel } from '@/lib/usePiKernel';

export type ChatKernelSetting = 'sessionGoal' | 'sessionAssist';

/**
 * Kernel-specific Settings Chat groups. OpenChamber Session Goal stays
 * hidden on Pi. Session Assist remains OpenCode-only.
 */
export function chatKernelSettings(isPiKernel: boolean): ChatKernelSetting[] {
  return [
    ...(isSessionGoalVisibleOnPiKernel(isPiKernel) ? ['sessionGoal' as const] : []),
    ...(!isPiKernel ? ['sessionAssist' as const] : []),
  ];
}
