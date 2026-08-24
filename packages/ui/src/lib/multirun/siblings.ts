import type { Session } from '@opencode-ai/sdk/v2';

import { parseMultiRunSessionTitle, type ParsedMultiRunTitle } from './title';

export const isSameMultiRunGroup = (
  left: ParsedMultiRunTitle,
  right: ParsedMultiRunTitle,
): boolean => (
  left.groupSlug === right.groupSlug
  && (left.runGroup ?? null) === (right.runGroup ?? null)
);

export const collectMultiRunSiblings = (
  anchor: Session,
  sessions: readonly Session[],
): Session[] => {
  const parsed = parseMultiRunSessionTitle(anchor.title);
  if (!parsed) return [];

  const byId = new Map<string, Session>();
  for (const candidate of sessions) {
    const candidateParsed = parseMultiRunSessionTitle(candidate.title);
    if (!candidateParsed || candidateParsed.fusion) continue;
    if (!isSameMultiRunGroup(parsed, candidateParsed)) continue;
    byId.set(candidate.id, candidate);
  }
  if (!parsed.fusion && !byId.has(anchor.id)) byId.set(anchor.id, anchor);

  return Array.from(byId.values()).sort((left, right) => (
    (left.time?.created ?? 0) - (right.time?.created ?? 0)
    || left.id.localeCompare(right.id)
  ));
};

export const collectMultiRunSiblingsFromAnchors = (
  anchors: readonly Session[],
  sessions: readonly Session[],
): Session[] => {
  const byId = new Map<string, Session>();
  for (const anchor of anchors) {
    for (const sibling of collectMultiRunSiblings(anchor, sessions)) {
      byId.set(sibling.id, sibling);
    }
  }
  return Array.from(byId.values()).sort((left, right) => (
    (left.time?.created ?? 0) - (right.time?.created ?? 0)
    || left.id.localeCompare(right.id)
  ));
};
