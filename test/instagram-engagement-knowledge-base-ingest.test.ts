import { describe, expect, it } from 'vitest';
import {
  buildKnowledgeBaseChunks,
  parseCanonicalKnowledgeSourceRegistry,
  type CanonicalKnowledgeSourceRegistryRow,
} from '../src/instagram-engagement/knowledge-base-ingest.js';

function source(
  sourceId: string,
  kind: CanonicalKnowledgeSourceRegistryRow['kind'],
): CanonicalKnowledgeSourceRegistryRow {
  return {
    sourceId,
    title: `Source ${sourceId}`,
    driveId: `drive-${sourceId}`,
    scope: 'scope',
    precedence: 'ALTA',
    status: 'CANONICO',
    kind,
  };
}

describe('Instagram engagement canonical knowledge ingestion', () => {
  it('accepts only active/canonical source registry rows', () => {
    const rows = parseCanonicalKnowledgeSourceRegistry([
      ['source_id', 'titulo', 'drive_id', 'escopo', 'precedencia', 'verificado_em', 'status'],
      ['SRC-OPS-001', 'Ops', 'ops-drive', 'horarios', 'ALTA', '2026-08-28', 'CANONICO'],
      ['SRC-OLD-001', 'Old', 'old-drive', 'legacy', 'BAIXA', '2025-01-01', 'SUPERSEDED'],
    ]);

    expect(rows.map((row) => row.sourceId)).toEqual(['SRC-OPS-001']);
    expect(rows[0]?.kind).toBe('OPERATIONS');
  });

  it('extracts only bounded low-risk operational facts', () => {
    const chunks = buildKnowledgeBaseChunks(
      source('SRC-OPS-001', 'OPERATIONS'),
      `
- SUNSET: todos os dias, a partir das 16:30, America/Bahia. O horário de encerramento não deve ser presumido sem regra/evento específico vigente.
- THE PARTY: todas as sextas-feiras, 23:59–06:00, America/Bahia, compreendendo a noite de sexta até 06:00 de sábado.
- Valores de ingressos do SUNSET e das festas NÃO devem ser hardcoded: consultar o site oficial ou o link da bio do Instagram no momento do atendimento/publicação.
- Site oficial: www.tocadomorcego.com.br.
- Instagram oficial: @tocadomorcego.
- WhatsApp oficial de atendimento informado pela direção: +55 75 99179-5418. Evidência arquivada.
      `,
    );

    expect(chunks.length).toBe(6);
    expect(chunks.every((chunk) => chunk.risk === 'LOW')).toBe(true);
    expect(chunks.every((chunk) => chunk.autonomy === 'AUTO_REPLY_ALLOWED')).toBe(true);
    expect(chunks.some((chunk) => chunk.content.includes('16:30'))).toBe(true);
    expect(chunks.some((chunk) => chunk.content.includes('+55 75 99179-5418'))).toBe(true);
  });

  it('turns active structured menu rows into source-bound operational chunks', () => {
    const chunks = buildKnowledgeBaseChunks(
      source('SRC-MENU-002', 'MENU_STRUCTURED'),
      `ID,Domínio,Categoria,Item,Descrição,Preço exibido,Preço 1,Preço 2,Observação,Página,Status
49,Bar,Autoral,Pedra do Morcego,"Cachaça, cordial de coco tostado e mix cítrico da casa.",R$ 50,50,,,2,ATIVO
50,Gastronomia,Petiscos da Toca,Casquinha de Siri,"Casquinha cremosa de siri.",R$ 35,35,,,3,ATIVO
51,Bar,Legacy,Antigo,,R$ 10,10,,,2,INATIVO`,
    );

    expect(chunks).toHaveLength(2);
    expect(chunks[0]?.heading).toBe('Pedra do Morcego');
    expect(chunks[0]?.content).toContain('R$ 50');
    expect(chunks.every((chunk) => chunk.intentHints.includes('FAQ_OPERATIONAL'))).toBe(true);
  });

  it('uses only the stable location field from the legacy broader knowledge document', () => {
    const chunks = buildKnowledgeBaseChunks(
      source('SRC-LOC-001', 'LOCATION'),
      `Base de Conhecimento — Toca do Morcego
Localização: Morro de São Paulo, Ilha de Tinharé, Bahia, Brasil
Ingresso: R$ 10,00
Evento antigo: Bailão`,
    );

    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.content).toContain('Morro de São Paulo');
    expect(chunks[0]?.content).not.toContain('R$ 10,00');
    expect(chunks[0]?.content).not.toContain('Bailão');
  });

  it('does not turn policy documents into response content', () => {
    expect(
      buildKnowledgeBaseChunks(source('SRC-POL-001', 'POLICY'), 'policy content'),
    ).toEqual([]);
  });
});
