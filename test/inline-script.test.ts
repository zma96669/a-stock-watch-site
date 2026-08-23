import { describe, expect, it } from 'vitest';
import { serializeForInlineScript } from '../src/views/inline-script';

describe('serializeForInlineScript', () => {
  it('keeps normal JSON data intact', () => {
    expect(JSON.parse(serializeForInlineScript({ name: '贵州茅台', code: '600519' })))
      .toEqual({ name: '贵州茅台', code: '600519' });
  });

  it('escapes characters that can terminate or corrupt an inline script', () => {
    const serialized = serializeForInlineScript({ name: '</script>&>\u2028\u2029' });
    expect(serialized).not.toContain('</script>');
    expect(serialized).not.toContain('&');
    expect(serialized).not.toContain('\u2028');
    expect(serialized).not.toContain('\u2029');
    expect(JSON.parse(serialized)).toEqual({ name: '</script>&>\u2028\u2029' });
  });
});
