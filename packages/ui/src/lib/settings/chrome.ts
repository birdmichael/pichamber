import type { SettingsSearchResult } from './search';

const SETTINGS_SEARCH_HIGHLIGHT_MS = 1600;
const SETTINGS_SEARCH_HIGHLIGHT_ATTEMPTS = 12;

export function escapeSettingsItemSelector(id: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(id);
  }
  return id.replace(/[^a-zA-Z0-9_-]/g, '\\$&');
}

export function querySettingsItem(container: ParentNode | null, id: string): HTMLElement | null {
  if (!container) {
    return null;
  }
  return container.querySelector<HTMLElement>(`[data-settings-item="${escapeSettingsItemSelector(id)}"]`);
}

export function settingsSearchPreparesEntityDraft(result: Pick<SettingsSearchResult, 'id' | 'page'>): boolean {
  if (result.page === 'skills.catalog') {
    return false;
  }
  return (
    result.id.startsWith('agents.')
    || result.id.startsWith('commands.')
    || result.id.startsWith('mcp.')
    || result.id.startsWith('snippets.')
    || result.id.startsWith('skills.')
    || result.id === 'providers.connect'
  );
}

export function resolveSettingsSearchHighlightId(result: Pick<SettingsSearchResult, 'id'>): string {
  switch (result.id) {
    case 'agents.create':
      return 'agents.name';
    case 'commands.create':
      return 'commands.name';
    case 'mcp.create':
      return 'mcp.server';
    case 'snippets.create':
      return 'snippets.content';
    case 'skills.create':
      return 'skills.basic-information';
    case 'plugins.create':
      return 'plugins.spec';
    default:
      return result.id;
  }
}

function firstFocusable(target: HTMLElement): HTMLElement {
  if (target.matches('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')) {
    return target;
  }
  return target.querySelector<HTMLElement>(
    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
  ) ?? target;
}

function focusSettingsSearchTarget(target: HTMLElement): void {
  target.scrollIntoView({ block: 'center', behavior: 'smooth' });
  target.setAttribute('data-settings-search-highlight', 'true');
  const focusable = firstFocusable(target);
  if (focusable.tabIndex < 0 && focusable === target) {
    focusable.tabIndex = -1;
  }
  focusable.focus({ preventScroll: true });
}

export function scheduleSettingsSearchHighlight(options: {
  container: ParentNode | null | (() => ParentNode | null);
  targetId: string;
  onFound?: (target: HTMLElement) => void;
  onMiss?: () => void;
  attempts?: number;
  highlightMs?: number;
}): () => void {
  const attempts = options.attempts ?? SETTINGS_SEARCH_HIGHLIGHT_ATTEMPTS;
  const highlightMs = options.highlightMs ?? SETTINGS_SEARCH_HIGHLIGHT_MS;
  let cancelled = false;
  let attempt = 0;
  let frame = 0;
  let highlightTimer = 0;
  const resolveContainer = () => (
    typeof options.container === 'function' ? options.container() : options.container
  );

  const run = () => {
    if (cancelled) {
      return;
    }
    const target = querySettingsItem(resolveContainer(), options.targetId);
    if (target) {
      focusSettingsSearchTarget(target);
      options.onFound?.(target);
      highlightTimer = window.setTimeout(() => {
        target.removeAttribute('data-settings-search-highlight');
      }, highlightMs);
      return;
    }
    attempt += 1;
    if (attempt >= attempts) {
      options.onMiss?.();
      return;
    }
    frame = window.requestAnimationFrame(run);
  };

  frame = window.requestAnimationFrame(run);

  return () => {
    cancelled = true;
    window.cancelAnimationFrame(frame);
    if (highlightTimer) {
      window.clearTimeout(highlightTimer);
    }
  };
}
