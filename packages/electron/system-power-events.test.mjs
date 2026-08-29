import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'bun:test';

import {
  mapSystemPowerEvent,
  registerSystemPowerMonitorListeners,
} from './system-power-events.mjs';

const createMonitor = () => {
  const listeners = new Map();
  return {
    on(name, handler) {
      const list = listeners.get(name) || [];
      list.push(handler);
      listeners.set(name, list);
    },
    emit(name) {
      for (const handler of listeners.get(name) || []) handler();
    },
    listenerCount(name) {
      return (listeners.get(name) || []).length;
    },
  };
};

describe('mapSystemPowerEvent', () => {
  test('resume emits only system-resume', () => {
    expect(mapSystemPowerEvent('resume', 123)).toEqual([
      { event: 'openchamber:system-resume', detail: { timestamp: 123 } },
    ]);
  });

  test('unlock-screen is the only visible presence', () => {
    expect(mapSystemPowerEvent('unlock-screen')).toEqual([
      { event: 'openchamber:system-presence', detail: { visible: true, reason: 'unlock-screen' } },
    ]);
    expect(mapSystemPowerEvent('lock-screen')).toEqual([
      { event: 'openchamber:system-presence', detail: { visible: false, reason: 'lock-screen' } },
    ]);
    expect(mapSystemPowerEvent('suspend')).toEqual([
      { event: 'openchamber:system-presence', detail: { visible: false, reason: 'suspend' } },
    ]);
  });
});

describe('registerSystemPowerMonitorListeners', () => {
  test('is idempotent and maps resume without presence visible', () => {
    const powerMonitor = createMonitor();
    const emitted = [];
    const emit = (event, detail) => {
      emitted.push({ event, detail });
    };

    expect(registerSystemPowerMonitorListeners({
      powerMonitor,
      emit,
      now: () => 99,
    })).toBe(true);
    expect(registerSystemPowerMonitorListeners({
      powerMonitor,
      emit,
      now: () => 99,
    })).toBe(false);
    expect(powerMonitor.listenerCount('resume')).toBe(1);

    powerMonitor.emit('resume');
    expect(emitted).toEqual([
      { event: 'openchamber:system-resume', detail: { timestamp: 99 } },
    ]);

    powerMonitor.emit('lock-screen');
    powerMonitor.emit('unlock-screen');
    expect(emitted.slice(1)).toEqual([
      { event: 'openchamber:system-presence', detail: { visible: false, reason: 'lock-screen' } },
      { event: 'openchamber:system-presence', detail: { visible: true, reason: 'unlock-screen' } },
    ]);
  });
});

describe('whenReady registration', () => {
  test('registers powerMonitor listeners before the hidden-login return', () => {
    const source = fs.readFileSync(fileURLToPath(new URL('./main.mjs', import.meta.url)), 'utf8');
    const registerAt = source.indexOf('registerSystemPowerMonitorListeners({');
    const backgroundAt = source.indexOf('if (isBackgroundStart) {');
    expect(registerAt).toBeGreaterThan(-1);
    expect(backgroundAt).toBeGreaterThan(registerAt);
    expect(source.includes("reason: 'resume'")).toBe(false);
  });
});
