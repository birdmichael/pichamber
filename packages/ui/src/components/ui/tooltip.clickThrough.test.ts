import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const tooltipSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'tooltip.tsx'),
  'utf8',
);

describe('tooltip click-through', () => {
  test('positioner and popup do not intercept pointer events', () => {
    expect(tooltipSource).toContain('className="pointer-events-none z-[200]"');
    expect(tooltipSource).toMatch(/oc-glass-tooltip pointer-events-none/);
  });

  test('an activating mouse press cannot open the tooltip', () => {
    expect(tooltipSource).toContain('shouldSuppressTooltipOpen');
    expect(tooltipSource).toContain('pointerPressActiveRef');
  });

  test('tooltips behind an open dialog do not open or stay open', () => {
    expect(tooltipSource).toContain('subscribeDialogOpenLayer');
    expect(tooltipSource).toContain('trigger: triggerElementRef.current');
    expect(tooltipSource).toContain('rememberTrigger');
  });

  test('a leftover tooltip dismiss does not stop the press that closed it', () => {
    expect(tooltipSource).toContain('shouldAllowTooltipDismissPropagation');
    expect(tooltipSource).toContain('allowPropagation');
    expect(tooltipSource).toContain('closeOnClick={false}');
    expect(tooltipSource).toContain('disableHoverablePopup');
    expect(tooltipSource).toContain('subscribeTooltipWindowBlur');
  });
});

