import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';

import { createSseBus } from './sse-bus.js';

const createFakeSseResponse = () => {
  const req = new EventEmitter();
  const chunks = [];
  const res = new EventEmitter();
  res.statusCode = 0;
  res.headers = {};
  res.writableEnded = false;
  res.destroyed = false;
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.setHeader = (key, value) => {
    res.headers[key] = value;
  };
  res.flushHeaders = () => {};
  res.write = (value) => {
    chunks.push(String(value));
    return true;
  };
  res.end = () => {
    res.writableEnded = true;
  };
  return { req, res, chunks };
};

describe('createSseBus', () => {
  it('publishes to subscribers and SSE clients', () => {
    const bus = createSseBus({ heartbeatMs: 60_000 });
    const seen = [];
    bus.subscribeEvent((event) => seen.push(event));
    const { req, res, chunks } = createFakeSseResponse();
    bus.attachSse(req, res);

    bus.publish('/tmp/project', { id: 'evt_1', type: 'session.idle', properties: { sessionID: 'ses_1' } }, { eventId: 'evt_1' });

    expect(seen[0].directory).toBe('/tmp/project');
    expect(seen[0].payload.type).toBe('session.idle');
    expect(chunks.join('')).toContain('id: evt_1');
    expect(chunks.join('')).toContain('"type":"session.idle"');
    bus.stop();
  });

  it('replays events after lastEventId', () => {
    const bus = createSseBus({ heartbeatMs: 60_000 });
    bus.publish('global', { type: 'a' }, { eventId: 'evt_a' });
    bus.publish('global', { type: 'b' }, { eventId: 'evt_b' });
    const replayed = bus.replayAfter('evt_a');
    expect(replayed).toHaveLength(1);
    expect(replayed[0].payload.type).toBe('b');
    bus.stop();
  });
});

  it('does not drop SSE clients when write returns false', () => {
    const bus = createSseBus({ heartbeatMs: 60_000 });
    const { req, res, chunks } = createFakeSseResponse();
    res.write = (value) => {
      chunks.push(String(value));
      return false;
    };
    bus.attachSse(req, res);
    bus.publish('/tmp/project', { id: 'evt_1', type: 'session.idle', properties: { sessionID: 'ses_1' } }, { eventId: 'evt_1' });
    bus.publish('/tmp/project', { id: 'evt_2', type: 'session.status', properties: { sessionID: 'ses_1', status: { type: 'idle' } } }, { eventId: 'evt_2' });
    expect(bus.getSseClientCount()).toBe(1);
    expect(chunks.join('')).toContain('evt_2');
    bus.stop();
  });

  it('replays the buffer to a fresh SSE client without lastEventId', () => {
    const bus = createSseBus({ heartbeatMs: 60_000 });
    bus.publish('/tmp/project', { id: 'evt_1', type: 'message.updated', properties: { sessionID: 'ses_1' } }, { eventId: 'evt_1' });
    const { req, res, chunks } = createFakeSseResponse();
    bus.attachSse(req, res);
    expect(chunks.join('')).toContain('evt_1');
    expect(chunks.join('')).toContain('message.updated');
    bus.stop();
  });
