import { describe, expect, it } from 'vitest';
import { loadSunsetStoryTemplateContract } from '../src/creative/sunset-story-template-contract.js';
import type { SunsetStoryTemplateId } from '../src/creative/sunset-story-template-registry.js';

const MINIMUM_TEXT_COVERAGE: Readonly<Record<SunsetStoryTemplateId, number>> = {
  SUNSET_TEMPLATE_MASTER_V1: 7,
  SUNSET_TEMPLATE_MASTER_V2: 3,
  SUNSET_TEMPLATE_MASTER_V3: 2,
  SUNSET_TEMPLATE_MASTER_V4: 3,
  SUNSET_TEMPLATE_MASTER_V5: 6,
  SUNSET_TEMPLATE_MASTER_V6: 7,
  SUNSET_TEMPLATE_MASTER_V7: 6,
  SUNSET_TEMPLATE_MASTER_V8: 6,
  SUNSET_TEMPLATE_MASTER_V9: 4,
};

describe('Sunset Story canonical template coverage', () => {
  it('keeps explicit text coverage for every approved V1-V9 contract', async () => {
    for (const [templateId, minimumTexts] of Object.entries(MINIMUM_TEXT_COVERAGE) as Array<
      [SunsetStoryTemplateId, number]
    >) {
      const contract = await loadSunsetStoryTemplateContract(templateId);
      expect(contract.texts.length, `${templateId} text coverage`).toBeGreaterThanOrEqual(
        minimumTexts,
      );
      const normalizedCopy = contract.texts.map((item) => item.text.toUpperCase()).join('\n');
      expect(normalizedCopy).not.toContain('ADICIONAR IMAGEM AQUI');
      expect(normalizedCopy).not.toContain('INSIRA A IMAGEM DE FUNDO');
    }
  });

  it('normalizes the V3 textRegion and separate outlineBox without rendering editor guidance', async () => {
    const contract = await loadSunsetStoryTemplateContract('SUNSET_TEMPLATE_MASTER_V3');
    const headline = contract.texts.find((item) => item.text === 'PÔR DO SOL');
    const outline = contract.shapes.find((item) => item.id === 'ELEMENTS.HEADLINE.BOX');

    expect(headline?.region).toEqual({ x: 109, y: 1309, width: 877, height: 130 });
    expect(outline).toMatchObject({
      region: { x: 64, y: 1300, width: 953, height: 167 },
      fill: 'none',
      stroke: '#FFFFFF',
      strokeWidthPx: 1,
    });
    expect(contract.texts.some((item) => item.text === 'adicionar imagem aqui')).toBe(false);
    expect(contract.editorOnlyStrings).toContain('adicionar imagem aqui');
  });

  it('expands the V4 fixed two-line headline into deterministic line regions', async () => {
    const contract = await loadSunsetStoryTemplateContract('SUNSET_TEMPLATE_MASTER_V4');
    const line1 = contract.texts.find((item) => item.id === 'ELEMENTS.HEADLINE.LINES.1');
    const line2 = contract.texts.find((item) => item.id === 'ELEMENTS.HEADLINE.LINES.2');

    expect(line1).toMatchObject({
      text: 'Temos drinks especiais',
      region: { x: 101, y: 1280, width: 873, height: 97 },
    });
    expect(line2).toMatchObject({
      text: 'para o Pôr do Sol',
      region: { x: 101, y: 1377, width: 873, height: 97 },
    });
  });
});
