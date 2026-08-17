/**
 * Settings → Pichamber Tools is leftover OpenCode-kernel chrome.
 * VS Code has no in-app browser rail. The Pi kernel uses the Pi section
 * on General instead of these leftover tool toggles.
 */
export function shouldShowPichamberToolsSettings(ctx: { isVSCode: boolean; isPiKernel?: boolean }): boolean {
  return !ctx.isVSCode && !ctx.isPiKernel;
}

/**
 * Agent-control / orchestration is leftover OpenCode-kernel chrome.
 * VS Code has no host tool injection. The Pi kernel hides these rows.
 */
export function shouldShowAgentControlToolSettings(ctx: { isVSCode?: boolean; isPiKernel?: boolean } = {}): boolean {
  return !ctx.isVSCode && !ctx.isPiKernel;
}
