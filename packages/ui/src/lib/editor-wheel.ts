export type ScrollMetrics = {
  scrollTop: number;
  clientHeight: number;
  scrollHeight: number;
};

/** True when a wheel over a nested editor should move the page instead. */
export function shouldChainWheelToParent(scroller: ScrollMetrics, deltaY: number): boolean {
  if (deltaY < 0) {
    return scroller.scrollTop <= 0;
  }
  if (deltaY > 0) {
    return scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 1;
  }
  return false;
}

export function chainWheelDeltaToAncestor(
  start: EventTarget | null,
  deltaY: number,
  ancestorSelector = '.overlay-scrollbar-container',
): boolean {
  if (!(start instanceof Element)) {
    return false;
  }
  const page = start.closest<HTMLElement>(ancestorSelector);
  if (!page) {
    return false;
  }
  page.scrollTop += deltaY;
  return true;
}
