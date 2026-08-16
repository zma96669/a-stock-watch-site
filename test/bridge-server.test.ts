import { afterEach, describe, expect, it } from 'vitest';
import { BackgroundBridge } from '../src/background/bridge-server';

let bridge: BackgroundBridge | undefined;
afterEach(async () => { await bridge?.stop(); bridge = undefined; });

describe('BackgroundBridge', () => {
  it('serves token-protected state on loopback', async () => {
    bridge = new BackgroundBridge(() => ({ ok: true }));
    const info = await bridge.start();
    const valid = await fetch(`http://127.0.0.1:${info.port}/${info.token}/state`);
    expect(valid.status).toBe(200);
    expect(await valid.json()).toEqual({ ok: true });
    const invalid = await fetch(`http://127.0.0.1:${info.port}/wrong/state`);
    expect(invalid.status).toBe(404);
  });

  it('reuses a supplied token across extension activations', async () => {
    bridge = new BackgroundBridge(() => ({ ok: true }), 'persistent-token');
    const info = await bridge.start();
    expect(info.token).toBe('persistent-token');
  });

  it('pushes a lightweight change event to connected loaders', async () => {
    bridge = new BackgroundBridge(() => ({ ok: true }));
    const info = await bridge.start();
    const controller = new AbortController();
    const response = await fetch(`http://127.0.0.1:${info.port}/${info.token}/events`, { signal: controller.signal });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    expect(decoder.decode((await reader.read()).value)).toContain('event: ready');

    bridge.notify();
    expect(decoder.decode((await reader.read()).value)).toContain('event: change');
    controller.abort();
  });
});

