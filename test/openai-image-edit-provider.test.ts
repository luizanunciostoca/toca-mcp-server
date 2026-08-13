import { describe, expect, it, vi } from 'vitest';
import type { SecretResolver } from '../src/core/secrets.js';
import {
  OpenAiImageEditProvider,
  TOCA_CANONICAL_IMAGE_TREATMENT_PROMPT,
} from '../src/providers/openai/openai-image-edit-provider.js';

const secretResolver: SecretResolver = {
  resolve: async () => 'test-api-key',
};

function request(overrides: Partial<Parameters<OpenAiImageEditProvider['edit']>[0]> = {}) {
  return {
    sourceAssetId: 'SUN-0087',
    sourceDriveFileId: 'drive-file-1234567890',
    imageBytes: Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]),
    contentType: 'image/jpeg' as const,
    ...overrides,
  };
}

describe('OpenAiImageEditProvider', () => {
  it('fails closed before provider access when source bytes are empty', async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const provider = new OpenAiImageEditProvider({
      secretResolver,
      apiKeyReference: { provider: 'env', key: 'OPENAI_API_KEY' },
      fetchImpl,
    });

    await expect(provider.edit(request({ imageBytes: new Uint8Array() }))).rejects.toMatchObject({
      code: 'SOURCE_IMAGE_FETCH_BLOCK',
      message: 'SOURCE_IMAGE_EMPTY',
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('fails closed when source identifiers are not bound', async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const provider = new OpenAiImageEditProvider({
      secretResolver,
      apiKeyReference: { provider: 'env', key: 'OPENAI_API_KEY' },
      fetchImpl,
    });

    await expect(provider.edit(request({ sourceAssetId: '' }))).rejects.toMatchObject({
      code: 'SOURCE_IMAGE_BINDING_FAILURE',
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('sends the real source image in multipart edit mode with high input fidelity', async () => {
    const output = Uint8Array.from([0xff, 0xd8, 0x01, 0x02, 0xff, 0xd9]);
    const fetchImpl = vi.fn<typeof fetch>(async (_input, init) => {
      expect(init?.method).toBe('POST');
      expect(init?.headers).toEqual({ Authorization: 'Bearer test-api-key' });
      expect(init?.body).toBeInstanceOf(FormData);
      const form = init?.body as FormData;
      expect(form.get('model')).toBe('gpt-image-1');
      expect(form.get('prompt')).toBe(TOCA_CANONICAL_IMAGE_TREATMENT_PROMPT);
      expect(form.get('input_fidelity')).toBe('high');
      expect(form.get('quality')).toBe('high');
      expect(form.get('size')).toBe('auto');
      expect(form.get('output_format')).toBe('jpeg');
      expect(form.get('output_compression')).toBe('100');
      const image = form.get('image');
      expect(image).toBeInstanceOf(Blob);
      expect(await (image as Blob).arrayBuffer()).toEqual(
        request().imageBytes.buffer.slice(
          request().imageBytes.byteOffset,
          request().imageBytes.byteOffset + request().imageBytes.byteLength,
        ),
      );
      return new Response(
        JSON.stringify({ data: [{ b64_json: Buffer.from(output).toString('base64') }] }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });

    const provider = new OpenAiImageEditProvider({
      secretResolver,
      apiKeyReference: { provider: 'env', key: 'OPENAI_API_KEY' },
      fetchImpl,
    });
    const result = await provider.edit(request());

    expect(result.sourceImageBound).toBe(true);
    expect(result.editMode).toBe('EDIT_EXISTING_IMAGE');
    expect(result.editorProvider).toBe('OPENAI_IMAGE_EDIT');
    expect(result.inputFidelity).toBe('high');
    expect(result.outputBytes).toEqual(output);
    expect(result.sourceSha256).not.toBe(result.outputSha256);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('rejects a provider response that does not contain an edited image', async () => {
    const provider = new OpenAiImageEditProvider({
      secretResolver,
      apiKeyReference: { provider: 'env', key: 'OPENAI_API_KEY' },
      fetchImpl: async () =>
        new Response(JSON.stringify({ data: [{}] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    });

    await expect(provider.edit(request())).rejects.toMatchObject({
      code: 'NATIVE_IMAGE_EDIT_BINDING_FAILED',
      message: 'OPENAI_IMAGE_EDIT_RESPONSE_MISSING_IMAGE',
    });
  });
});
