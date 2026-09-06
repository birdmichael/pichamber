/** Matches the Pi facade synthetic default from GET /api/agent (`name: "pi"`). */
const SYNTHETIC_PI_AGENT_NAME = 'pi';

/**
 * The Pi facade synthesizes a single primary agent named `pi`. That chip
 * does not switch anything. Hide it until a later list has more than that
 * synthetic default. OpenCode `build` / `plan` / custom agents stay visible.
 * The Subagents plugin is the exception: its roster is opened from this chip,
 * so the Pi-only list must keep the trigger mounted while that plugin is active.
 */
export function shouldShowComposerAgentChip(
  selectableAgents: ReadonlyArray<{ name: string }>,
  keepSyntheticPi = false,
): boolean {
  if (selectableAgents.length !== 1) {
    return true;
  }
  return keepSyntheticPi || selectableAgents[0]?.name !== SYNTHETIC_PI_AGENT_NAME;
}
