import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const wrapper = readFileSync('scripts/marketing-publish-now-fixed.sh', 'utf8');

describe('Marketing provider duplicate preflight image contract', () => {
  it('uses a dedicated immutable image CMD instead of Cloud Run command overrides', () => {
    expect(wrapper).toContain('publish-now-duplicate-preflight.Dockerfile');
    expect(wrapper).toContain('CMD ["node", "dist/src/instagram-provider-duplicate-preflight.js"]');
    expect(wrapper).toContain('preflight_image="${preflight_image_tag%:*}@${preflight_image_digest}"');
    expect(wrapper).toContain('--image "$preflight_image"');
    expect(wrapper).toContain('($container.image == $image)');
    expect(wrapper).toContain('(($container.command // []) | length == 0)');
    expect(wrapper).toContain('(($container.args // []) | length == 0)');

    const functionStart = wrapper.indexOf("strong_preflight = r'''provider_duplicate_preflight() {");
    const functionEnd = wrapper.indexOf("\n}\n\n'''", functionStart);
    expect(functionStart).toBeGreaterThan(-1);
    expect(functionEnd).toBeGreaterThan(functionStart);
    const preflight = wrapper.slice(functionStart, functionEnd);
    expect(preflight).not.toContain('--command node');
    expect(preflight).not.toContain('--args dist/src/instagram-provider-duplicate-preflight.js');
  });
});
