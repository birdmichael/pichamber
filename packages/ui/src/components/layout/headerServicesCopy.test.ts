import { describe, expect, test } from 'bun:test';

import { headerServicesOpenAriaKey } from './headerServicesCopy';

describe('headerServicesOpenAriaKey', () => {
  test('uses Pi instance-only copy on the desktop Pi kernel', () => {
    expect(headerServicesOpenAriaKey(true, true)).toBe('header.services.openWithCurrentPi');
  });

  test('keeps Usage and MCP wording on the desktop OpenCode kernel', () => {
    expect(headerServicesOpenAriaKey(true, false)).toBe('header.services.openWithCurrent');
  });

  test('keeps the non-desktop services label regardless of kernel', () => {
    expect(headerServicesOpenAriaKey(false, true)).toBe('header.services.open');
    expect(headerServicesOpenAriaKey(false, false)).toBe('header.services.open');
  });
});
