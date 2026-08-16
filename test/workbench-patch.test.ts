import { describe, expect, it } from 'vitest';
import { allowLocalBridge } from '../src/background/workbench-patch';

const vscodeCsp = `<meta
  http-equiv="Content-Security-Policy"
  content="
    default-src
      'none'
    ;
    script-src
      'self'
      'unsafe-eval'
      blob:
    ;
    connect-src
      'self'
      https:
      ws:
    ;
  "
>`;

describe('allowLocalBridge', () => {
  it('patches the multiline CSP used by VS Code 1.110', () => {
    const patched = allowLocalBridge(vscodeCsp);
    expect(patched).toContain('http://127.0.0.1:*');
    expect(patched).not.toContain('file:');
    expect(patched.indexOf('http://127.0.0.1:*')).toBeLessThan(patched.indexOf(';', patched.indexOf('connect-src')));
  });

  it('is idempotent', () => {
    const once = allowLocalBridge(vscodeCsp);
    expect(allowLocalBridge(once)).toBe(once);
  });
});
