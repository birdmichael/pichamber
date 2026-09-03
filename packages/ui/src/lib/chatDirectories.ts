import { opencodeClient } from '@/lib/opencode/client';
import { normalizePath } from '@/lib/pathNormalization';
import { runtimeFetch } from '@/lib/runtime-fetch';
import { getRuntimeKey } from '@/lib/runtime-switch';

export const CHAT_DRAFT_PROJECT_ID = 'openchamber:chats';
const MANAGED_CHATS_PATH_SEGMENTS = [
  '/.config/pichamber/chats/',
  '/.config/openchamber/chats/',
] as const;
const chatsRootByRuntime = new Map<string, Promise<string>>();

const matchingChatsPathSegment = (normalized: string | null | undefined): string | null => {
  if (!normalized) return null;
  return MANAGED_CHATS_PATH_SEGMENTS.find((segment) => normalized.includes(segment)) ?? null;
};

const joinPath = (base: string, ...parts: string[]): string => {
  const separator = base.includes('\\') ? '\\' : '/';
  return [base.replace(/[\\/]+$/, ''), ...parts].join(separator);
};

export function isChatDirectoryForHome(directory: string | null | undefined, home: string | null | undefined): boolean {
  const normalized = normalizePath(directory ?? null);
  if (matchingChatsPathSegment(normalized)) return true;
  const normalizedHome = normalizePath(home ?? null);
  if (!normalized || !normalizedHome) return false;
  return MANAGED_CHATS_PATH_SEGMENTS.some((segment) => {
    const root = normalizePath(joinPath(normalizedHome, ...segment.slice(1, -1).split('/')));
    return Boolean(root && (normalized === root || normalized.startsWith(`${root}/`)));
  });
}

export function isChatDirectoryPath(directory: string | null | undefined): boolean {
  return matchingChatsPathSegment(normalizePath(directory ?? null)) !== null;
}

export function getChatsRootFromDirectory(directory: string | null | undefined): string | null {
  const normalized = normalizePath(directory ?? null);
  const segment = matchingChatsPathSegment(normalized);
  if (!normalized || !segment) return null;
  const index = normalized.indexOf(segment);
  return index >= 0 ? normalized.slice(0, index + segment.length - 1) : null;
}

export function getChatsRootForHome(home: string | null | undefined): string | null {
  const normalizedHome = normalizePath(home ?? null);
  return normalizedHome ? normalizePath(joinPath(normalizedHome, '.config', 'pichamber', 'chats')) : null;
}

/**
 * Sidebar/session grouping: isolated chat dirs, plus home/`~` when that folder
 * is not an opened project. Home that is itself a Settings project stays a
 * project chat.
 */
export function isManagedChatDirectory(
  directory: string | null | undefined,
  home: string | null | undefined,
  openedProjectPaths?: ReadonlySet<string> | null,
): boolean {
  if (isChatDirectoryForHome(directory, home)) return true;
  const normalized = normalizePath(directory ?? null);
  const normalizedHome = normalizePath(home ?? null);
  if (!normalized || !normalizedHome || normalized !== normalizedHome) return false;
  return !openedProjectPaths?.has(normalizedHome);
}

export type NewSessionComposerDraft = {
  open?: boolean;
  target?: 'chat' | 'project';
  bootstrapPendingDirectory?: string | null;
  directoryOverride?: string | null;
  preparedChatDirectory?: string | null;
};

/**
 * Composer identity directory for an unsent New session.
 * Projectless chats must not share `~` / the last session path with a real
 * session draft, or Sidebar New session restores that leftover text.
 */
export function resolveNewSessionComposerDirectory(
  draft: NewSessionComposerDraft | null | undefined,
): string | null {
  if (!draft?.open) return null;
  if (draft.target === "chat") {
    return normalizePath(draft.bootstrapPendingDirectory ?? draft.preparedChatDirectory ?? null)
      ?? CHAT_DRAFT_PROJECT_ID;
  }
  return normalizePath(draft.bootstrapPendingDirectory ?? draft.directoryOverride ?? null);
}

async function getChatsRootDirectory(): Promise<string> {
  const runtimeKey = getRuntimeKey();
  const existing = chatsRootByRuntime.get(runtimeKey);
  if (existing) return existing;

  const pending = opencodeClient.getFilesystemHome().then((home) => {
    if (!home) throw new Error('Unable to resolve the home directory');
    return joinPath(home, '.config', 'pichamber', 'chats');
  }).catch((error) => {
    chatsRootByRuntime.delete(runtimeKey);
    throw error;
  });
  chatsRootByRuntime.set(runtimeKey, pending);
  return pending;
}

export function warmChatsRootDirectory(): void {
  void getChatsRootDirectory().catch(() => undefined);
}

export async function createChatDirectory(now = new Date()): Promise<string> {
  const root = await getChatsRootDirectory();
  const date = [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0')].join('-');
  const dateDirectory = joinPath(root, date);
  const id = globalThis.crypto?.randomUUID?.() ?? `${now.getTime()}-${Math.random().toString(36).slice(2)}`;
  const directory = joinPath(dateDirectory, `session-${id}`);
  await opencodeClient.createDirectory(directory);
  return directory;
}

export async function resolveChatSessionDirectory(): Promise<string> {
  try {
    return await createChatDirectory();
  } catch {
    const home = await opencodeClient.getFilesystemHome();
    if (!home) throw new Error('Unable to resolve the home directory');
    return home;
  }
}

async function isChatDirectory(directory: string | null | undefined): Promise<boolean> {
  const normalized = normalizePath(directory ?? null);
  if (!normalized) return false;
  if (isChatDirectoryPath(normalized)) return true;
  const root = normalizePath(await getChatsRootDirectory());
  return Boolean(root && (normalized === root || normalized.startsWith(`${root}/`)));
}

export async function deleteChatDirectory(directory: string): Promise<void> {
  if (!await isChatDirectory(directory)) return;
  const response = await runtimeFetch('/api/fs/delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: directory }),
  });
  if (!response.ok && response.status !== 404) {
    throw new Error(`Failed to delete chat directory (${response.status})`);
  }
}
