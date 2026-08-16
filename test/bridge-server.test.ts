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
});

