import { clampBoundsToWorkArea } from './linux-native-dialog-bounds.mjs';

const positiveInt = (value, fallback = 1) => {
  const n = Math.round(Number(value));
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

/**
 * Clamp Mini Chat to the display work area.
 *
 * Preferred 520×760 must stay fully inside an 800px / docked ~743px work area.
 * If the work area is smaller than minSize, use the work area (do not force
 * 480px minHeight off-screen). Missing workArea returns preferred (≥1×1).
 */
export const resolveMiniChatWindowSize = ({
  workArea = null,
  preferred = { width: 1, height: 1 },
  minSize = { width: 1, height: 1 },
} = {}) => {
  const preferredWidth = positiveInt(preferred?.width);
  const preferredHeight = positiveInt(preferred?.height);
  if (!workArea || !(Number(workArea.width) > 0) || !(Number(workArea.height) > 0)) {
    return { width: preferredWidth, height: preferredHeight };
  }

  const minWidth = positiveInt(minSize?.width);
  const minHeight = positiveInt(minSize?.height);
  const areaWidth = positiveInt(workArea.width);
  const areaHeight = positiveInt(workArea.height);
  const width = Math.min(Math.max(preferredWidth, minWidth), areaWidth);
  const height = Math.min(Math.max(preferredHeight, minHeight), areaHeight);
  const areaX = Number.isFinite(Number(workArea.x)) ? Math.round(Number(workArea.x)) : 0;
  const areaY = Number.isFinite(Number(workArea.y)) ? Math.round(Number(workArea.y)) : 0;
  return clampBoundsToWorkArea({
    x: areaX + Math.round((areaWidth - width) / 2),
    y: areaY + Math.round((areaHeight - height) / 2),
    width,
    height,
  }, workArea);
};

export const resolveMiniChatMaximizedBounds = (workArea) => {
  if (!workArea || !(Number(workArea.width) > 0) || !(Number(workArea.height) > 0)) {
    return null;
  }
  return {
    x: Number.isFinite(Number(workArea.x)) ? Math.round(Number(workArea.x)) : 0,
    y: Number.isFinite(Number(workArea.y)) ? Math.round(Number(workArea.y)) : 0,
    width: Math.max(1, Math.round(Number(workArea.width))),
    height: Math.max(1, Math.round(Number(workArea.height))),
  };
};

export const resolveMiniChatMinimumSize = ({
  workArea = null,
  minSize = { width: 1, height: 1 },
} = {}) => {
  const minWidth = positiveInt(minSize?.width);
  const minHeight = positiveInt(minSize?.height);
  if (!workArea || !(Number(workArea.width) > 0) || !(Number(workArea.height) > 0)) {
    return { width: minWidth, height: minHeight };
  }
  return {
    width: Math.min(minWidth, positiveInt(workArea.width)),
    height: Math.min(minHeight, positiveInt(workArea.height)),
  };
};

export const isLinuxMiniChatWorkAreaMaximized = (browserWindow, platform) => (
  platform === 'linux'
  && Boolean(browserWindow?.__ocMiniChat)
  && Boolean(browserWindow.__ocMiniChatFilledWorkArea)
);
