# Pichamber

[![GitHub release](https://img.shields.io/github/v/release/birdmichael/pichamber?style=flat&labelColor=100F0F&color=205EA6)](https://github.com/birdmichael/pichamber/releases/latest)
[![GitHub stars](https://img.shields.io/github/stars/birdmichael/pichamber?style=flat&labelColor=100F0F&color=66800B)](https://github.com/birdmichael/pichamber/stargazers)

**Pichamber is a macOS desktop workspace for [Pi](https://github.com/earendil-works/pi).** Direct the agent, review the diff, and keep sessions, skills, and git in one window.

This is a new product line on a fork of OpenChamber. Versioning started at **1.0.0** and is independent of OpenChamber. The current release is **1.2.5**. The kernel is in-process Pi (`@earendil-works/pi-coding-agent`), not an OpenCode child process.

![Pichamber](docs/references/chat_example.png)

## What you get

- **Pi models and thinking** — providers and models come from `~/.pi/agent` at runtime. Thinking levels (`off` … `max`) sit next to the composer model chip. A project can pin a thinking level next to its model.
- **Feature Plugins** — Goal, Plan, MCP, Subagents, and Btw. On/off follows Pi `settings.json` packages only; there is no Desktop Enabled checkbox. After `pi-subagents` is installed, child runs nest under the parent in the sidebar; expand the parent and click the child to open that chat. `/btw` exists only after installing `npm:@narumitw/pi-btw`; without it, `/btw` is a normal chat message.
- **Chats without a project** — start a chat without choosing a folder. Those sessions live in their own sidebar section and do not inherit a repository or worktree.
- **Skills, prompts, and commands** — user and project skills under `~/.pi/agent` and `.pi`. Slash commands are Pi builtins plus your prompts. Skills Catalog is a card grid with counts, search, and repo links.
- **Sessions** — compact, scoped models, export/import JSONL or HTML, and a session tree for fork-from-here.
- **Scheduled Tasks** — a Pichamber scheduler that creates a real Pi session and sends the task prompt. The sidebar calendar, `/schedule-task`, and Multi-run stay available on Pi.
- **Dictation** — speech is transcribed after you stop. The composer shows a waveform and timer while you record.
- **Custom providers** — OpenAI Chat Completions, OpenAI Responses, or Anthropic Messages.
- **Project trust** — decide whether a folder may load `.pi` settings and extensions.
- **Files, git, and terminal** — review changes, open PRs, and keep a docked shell beside the chat.

Provider-quota Usage, Share, Revert, composer `/shell`, and the OpenCode CLI are hidden on the Pi kernel.

## Quick start

Product target: **macOS Desktop (Electron)**. Web is only for backend testing. See [`docs/PICHAMBER.md`](docs/PICHAMBER.md).

```bash
bun install
bun run electron:dev          # HMR desktop, boots Pi
bun run electron:build        # Mac only: Pichamber-*.dmg in packages/electron/dist
```

Configure Pi the usual way:

- `~/.pi/agent/auth.json`
- `~/.pi/agent/models.json`
- optional `~/.pi/agent/settings.json`, `AGENTS.md`, `SYSTEM.md`, skills, prompts

The `pi` CLI on your PATH is optional. Desktop embeds the Pi SDK.

`OPENCHAMBER_KERNEL` defaults to `pi`. Set `OPENCHAMBER_KERNEL=opencode` only if you need the leftover OpenCode process path.

## Branch and version

| Ref | Role |
| --- | --- |
| [`main`](https://github.com/birdmichael/pichamber) | Pi kernel mainline, Pichamber **1.2.5** |
| [`legacy/openchamber`](https://github.com/birdmichael/pichamber/tree/legacy/openchamber) | Pre-Pi OpenChamber history |

Land **one verified feature per pull request** into `main`. Do not open PRs against upstream [`openchamber/openchamber`](https://github.com/openchamber/openchamber).

## Docs

- [Pichamber on Pi](docs/PICHAMBER.md)
- [Reverse proxy](docs/REVERSE_PROXY.md)
- [Custom themes](docs/CUSTOM_THEMES.md)
- [Contributing](CONTRIBUTING.md)

## Acknowledgments

Pichamber started from [OpenChamber](https://github.com/openchamber/openchamber) and runs on [Pi](https://github.com/earendil-works/pi). Thanks to both projects, and to [Pierre](https://pierrejs-docs.vercel.app/) and [Ghostty-web](https://github.com/coder/ghostty-web) for the diff and terminal pieces that remain in the UI.

Pichamber is an independent fork. It is not affiliated with the OpenChamber or OpenCode teams.

## License

MIT
