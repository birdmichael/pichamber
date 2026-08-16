/** Matches the Pi facade synthetic default from GET /api/agent (`name: "pi"`). */
const SYNTHETIC_PI_AGENT_NAME = 'pi';

/**
 * The Pi facade synthesizes a single primary agent named `pi`. That chip
 * does not switch anything. Hide it until a later list has more than that
 * synthetic default. OpenCode `build` / `plan` / custom agents stay visible.
 */
export function shouldShowComposerAgentChip(
  selectableAgents: ReadonlyArray<{ name: string }>,
): boolean {
  if (selectableAgents.length !== 1) {
    return true;
  }
  return selectableAgents[0]?.name !== SYNTHETIC_PI_AGENT_NAME;
}
