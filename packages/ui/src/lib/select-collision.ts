/** Keep a select menu on the requested side and shrink it; do not flip over the trigger. */
export const SELECT_PREFER_BELOW_COLLISION = {
  side: 'shift',
  align: 'shift',
  fallbackAxisSide: 'none',
} as const;

export type SelectPreferBelowCollision = typeof SELECT_PREFER_BELOW_COLLISION;
