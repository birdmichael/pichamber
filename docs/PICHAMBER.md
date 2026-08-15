# Pichamber on Pi

Pichamber keeps the OpenChamber UI (`@opencode-ai/sdk/v2`) and serves an OpenCode-shaped HTTP/SSE facade backed by [Pi](https://github.com/earendil-works/pi) (`@earendil-works/pi-coding-agent`).

The happy path does **not** require OpenCode to be installed.

## macOS (the supported product target)

1. Install [bun](https://bun.sh) and Node 22+.
2. Clone this repo and install dependencies:

```bash
bun install
```

3. Configure Pi auth/models the usual way (`~/.pi/agent`, or `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` in the environment). The `pi` CLI on your PATH is optional; the in-process SDK is preferred.
4. Start the web server:

```bash
OPENCHAMBER_KERNEL=pi bun run start:web
# or, during development:
OPENCHAMBER_KERNEL=pi bun run dev
```

`OPENCHAMBER_KERNEL` defaults to `pi`. Set `OPENCHAMBER_KERNEL=opencode` to restore the upstream OpenCode process + proxy.

5. Open the UI. Chat/session/event traffic stays on `/api/session`, `/api/global/event`, and `/api/global/event/ws`. Git, files, and terminal RuntimeAPIs are unchanged.

### Mock kernel (no LLM keys)

```bash
OPENCHAMBER_KERNEL=pi OPENCHAMBER_PI_MOCK=1 bun run start:web
```

Useful for UI/bootstrap work. Prompts stream a canned reply and still exercise session create, SSE, and abort.

## What the Pi facade implements

- Session CRUD, `prompt_async` / `prompt`, abort, messages, status
- Providers from `ModelRuntime.getAvailable()` (or a mock provider)
- Event mapping: `text_delta` → `message.part.delta` field `text`; `thinking_delta` → reasoning; `tool_execution_*` → tool parts; `agent_start` → busy; `agent_settled` → idle
- Empty-success stubs so bootstrap does not crash: MCP, LSP, permission, question, share, revert

## Still OpenCode-only / not ported

- Native OpenCode plugins, MCP OAuth, LSP diagnostics, permission/question dialogs, share, revert, and the managed OpenCode upgrade/binary resolver
- VS Code, mobile, Windows, and Linux desktop packaging were not the product target for this kernel swap

## Tests

```bash
cd packages/web
bunx vitest run server/lib/pi
```
