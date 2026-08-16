/**
 * Pichamber mark: open-top isometric cube (the chamber) with the official
 * Pi pixel-art "pi" wordmark in the same top-face slot as the old OpenCode O
 * (isometric center, scale 0.068). Not a raw pi.dev plate, Greek π, or
 * the rejected inside-the-volume scale(0.115) / ty=6 placement.
 */
export const PICHAMBER_MARK_VIEWBOX = '0 0 100 100';

export const PICHAMBER_INNER_GLYPH_TRANSFORM = 'matrix(0.866, 0.5, -0.866, 0.5, 50, 26) scale(0.068)';

export const PICHAMBER_CUBE_PATHS = [
  {
    d: 'M50 50 L8.432 26 L8.432 74 L50 98 Z',
    fillOpacity: 0.2,
  },
  {
    d: 'M50 50 L91.568 26 L91.568 74 L50 98 Z',
    fillOpacity: 0.35,
  },
  {
    d: 'M50 2 L8.432 26 L50 50 L91.568 26 Z',
    fill: 'none' as const,
  },
] as const;

export const PICHAMBER_INNER_GLYPH_PATHS = [
  {
    d: 'M-234.71 -234.71 H117.36 V0 H0 V117.36 H-117.35 V234.72 H-234.71 Z M-117.35 -117.35 V0 H0 V-117.35 Z',
    fillRule: 'evenodd' as const,
  },
  {
    d: 'M117.36 0 H234.72 V234.72 H117.36 Z',
  },
] as const;
