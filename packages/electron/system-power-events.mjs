const attachedMonitors = new WeakSet();

const POWER_MONITOR_EVENTS = ['resume', 'lock-screen', 'unlock-screen', 'suspend'];

/** resume reconnects SSE only. Presence visible:true is unlock-screen. */
export const mapSystemPowerEvent = (name, timestamp = Date.now()) => {
  if (name === 'resume') {
    return [{ event: 'openchamber:system-resume', detail: { timestamp } }];
  }
  if (name === 'unlock-screen') {
    return [{ event: 'openchamber:system-presence', detail: { visible: true, reason: 'unlock-screen' } }];
  }
  if (name === 'lock-screen' || name === 'suspend') {
    return [{ event: 'openchamber:system-presence', detail: { visible: false, reason: name } }];
  }
  return [];
};

export const registerSystemPowerMonitorListeners = ({
  powerMonitor,
  emit,
  now = Date.now,
} = {}) => {
  if (!powerMonitor || (typeof powerMonitor !== 'object' && typeof powerMonitor !== 'function')) {
    return false;
  }
  if (typeof powerMonitor.on !== 'function' || typeof emit !== 'function') {
    return false;
  }
  if (attachedMonitors.has(powerMonitor)) return false;
  attachedMonitors.add(powerMonitor);

  for (const name of POWER_MONITOR_EVENTS) {
    powerMonitor.on(name, () => {
      for (const mapped of mapSystemPowerEvent(name, now())) {
        emit(mapped.event, mapped.detail);
      }
    });
  }
  return true;
};
