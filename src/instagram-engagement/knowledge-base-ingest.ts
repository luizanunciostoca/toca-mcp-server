import { createHash } from 'node:crypto';
import type { EngagementIntent } from '../policy/engagement-policy.js';
import { normalizeKnowledgePrompt } from './knowledge.js';

export type InstagramKnowledgeSourceKind =
  | 'OPERATIONS'
  | 'MENU_STRUCTURED'
  | 'LOCATION'
  | 'BRAND'
  | 'PRODUCTS'
  | 'POLICY'
  | 'OTHER';

export interface CanonicalKnowledgeSourceRegistryRow {
  readonly sourceId: string;
  readonly title: string;
  readonly driveId: string;
  readonly scope: string;
  readonly precedence: string;
  readonly status: string;
  readonly kind: InstagramKnowledgeSourceKind;
}

export interface KnowledgeBaseChunkSeed {
  readonly stableKey: string;
  readonly heading: string;
  readonly content: string;
  readonly searchText: string;
  readonly intentHints: readonly EngagementIntent[];
  readonly risk: 'LOW' | 'MEDIUM';
  readonly autonomy: 'AUTO_REPLY_ALLOWED' | 'SUGGEST_ONLY';
  readonly sourceReference: string;
}

const ALLOWED_SOURCE_STATUSES = new Set([
  'CANONICO',
  'CANÔNICO',
  'CANONICO_DERIVADO',
  'REFERENCIA_VALIDADA_PARA_FATOS_ESTAVEIS',
  'ATIVO',
  'ACTIVE',
]);

export function parseCanonicalKnowledgeSourceRegistry(
  values: readonly (readonly unknown[])[],
): readonly CanonicalKnowledgeSourceRegistryRow[] {
  const [headerRow, ...rows] = values;
  if (!headerRow) return [];
  const headers = headerRow.map((value) => scalar(value).toLowerCase());
  const index = new Map(headers.map((name, position) => [name, position] as const));
  const required = ['source_id', 'titulo', 'drive_id', 'escopo', 'precedencia', 'status'];
  for (const key of required) {
    if (!index.has(key)) throw new Error(`INSTAGRAM_ENGAGEMENT_KB_SOURCE_SCHEMA_INVALID:${key}`);
  }

  return rows
    .map((row) => {
      const sourceId = cell(row, index, 'source_id');
      if (!sourceId) return undefined;
      const status = cell(row, index, 'status').toUpperCase();
      if (!ALLOWED_SOURCE_STATUSES.has(status)) return undefined;
      const title = cell(row, index, 'titulo');
      const driveId = cell(row, index, 'drive_id');
      const scope = cell(row, index, 'escopo');
      const precedence = cell(row, index, 'precedencia').toUpperCase();
      if (!title || !driveId || !scope || !precedence) {
        throw new Error(`INSTAGRAM_ENGAGEMENT_KB_SOURCE_ROW_INVALID:${sourceId}`);
      }
      return {
        sourceId,
        title,
        driveId,
        scope,
        precedence,
        status,
        kind: sourceKind(sourceId),
      } satisfies CanonicalKnowledgeSourceRegistryRow;
    })
    .filter((row): row is CanonicalKnowledgeSourceRegistryRow => row !== undefined);
}

export function buildKnowledgeBaseChunks(
  source: CanonicalKnowledgeSourceRegistryRow,
  text: string,
): readonly KnowledgeBaseChunkSeed[] {
  const clean = text.replace(/^\uFEFF/, '').trim();
  if (!clean) throw new Error(`INSTAGRAM_ENGAGEMENT_KB_SOURCE_EMPTY:${source.sourceId}`);
  if (source.kind === 'OPERATIONS') return buildOperationsChunks(source, clean);
  if (source.kind === 'MENU_STRUCTURED') return buildMenuChunks(source, clean);
  if (source.kind === 'LOCATION') return buildLocationChunks(source, clean);
  if (source.kind === 'BRAND') return buildBrandChunks(source, clean);
  if (source.kind === 'PRODUCTS') return buildProductsChunks(source, clean);
  return [];
}

export function knowledgeDocumentSha256(text: string): string {
  return createHash('sha256')
    .update(text.replace(/^\uFEFF/, ''), 'utf8')
    .digest('hex');
}

export function knowledgeDocumentId(sourceId: string): string {
  return `toca-os:${sourceId}`;
}

export function knowledgeChunkId(sourceId: string, stableKey: string): string {
  const key = normalizeKnowledgePrompt(stableKey).replace(/\s+/g, '-').slice(0, 80);
  if (!key) throw new Error('INSTAGRAM_ENGAGEMENT_KB_CHUNK_KEY_INVALID');
  return `${sourceId.toLowerCase()}:${key}`;
}

function buildOperationsChunks(
  source: CanonicalKnowledgeSourceRegistryRow,
  text: string,
): readonly KnowledgeBaseChunkSeed[] {
  const sourceReference = `${source.title} — Drive ID ${source.driveId}`;
  const chunks: KnowledgeBaseChunkSeed[] = [];
  const sunset = bulletValue(text, '- SUNSET:');
  if (sunset) {
    chunks.push({
      stableKey: 'sunset-hours',
      heading: 'Horário oficial do Sunset',
      content: sentence(`O Sunset ${sunset}`),
      searchText: `sunset horario horários abre abertura começa comeca quando que dia hoje todo dia funciona todos os dias ${sunset}`,
      intentHints: ['LOCATION_HOURS', 'EVENT_INFO'],
      risk: 'LOW',
      autonomy: 'AUTO_REPLY_ALLOWED',
      sourceReference,
    });
  }
  const party = bulletValue(text, '- THE PARTY:');
  if (party) {
    chunks.push({
      stableKey: 'the-party-hours',
      heading: 'Dia e horário oficial da The Party',
      content: sentence(`A The Party ${party}`),
      searchText: `the party festa sexta sabado sábado horario horários começa comeca termina que dia qual dia quando ${party}`,
      intentHints: ['LOCATION_HOURS', 'EVENT_INFO'],
      risk: 'LOW',
      autonomy: 'AUTO_REPLY_ALLOWED',
      sourceReference,
    });
  }
  const ticketRule = lineContaining(
    text,
    'Valores de ingressos do SUNSET e das festas NÃO devem ser hardcoded',
  );
  if (ticketRule) {
    chunks.push({
      stableKey: 'ticket-current-price-policy',
      heading: 'Preço e canal oficial de ingressos',
      content:
        'Os valores dos ingressos podem variar. Consulte o site oficial da Toca do Morcego ou o link da bio do Instagram para ver o valor vigente.',
      searchText: `ingresso ingressos preço preco valor valores entrada comprar compra site link bio ${ticketRule}`,
      intentHints: ['TICKET_INFO'],
      risk: 'LOW',
      autonomy: 'AUTO_REPLY_ALLOWED',
      sourceReference,
    });
  }
  const site = fieldFromLine(text, '- Site oficial:');
  if (site) {
    chunks.push({
      stableKey: 'official-site',
      heading: 'Site oficial da Toca do Morcego',
      content: `O site oficial é ${stripTerminalPunctuation(site)}.`,
      searchText: `site oficial toca do morcego website informações informacoes ${site}`,
      intentHints: ['FAQ_OPERATIONAL', 'GENERAL_SOCIAL'],
      risk: 'LOW',
      autonomy: 'AUTO_REPLY_ALLOWED',
      sourceReference,
    });
  }
  const instagram = fieldFromLine(text, '- Instagram oficial:');
  if (instagram) {
    chunks.push({
      stableKey: 'official-instagram',
      heading: 'Instagram oficial da Toca do Morcego',
      content: `O Instagram oficial é ${stripTerminalPunctuation(instagram)}.`,
      searchText: `instagram insta perfil oficial arroba toca do morcego ${instagram}`,
      intentHints: ['GENERAL_SOCIAL', 'FAQ_OPERATIONAL'],
      risk: 'LOW',
      autonomy: 'AUTO_REPLY_ALLOWED',
      sourceReference,
    });
  }
  const whatsapp = fieldFromLine(text, '- WhatsApp oficial de atendimento informado pela direção:');
  if (whatsapp) {
    const number = whatsapp.split('.', 1)[0]?.trim();
    if (number) {
      chunks.push({
        stableKey: 'official-whatsapp',
        heading: 'WhatsApp oficial de atendimento',
        content: `O WhatsApp oficial de atendimento é ${number}.`,
        searchText: `whatsapp contato telefone numero número atendimento toca ${number}`,
        intentHints: ['FAQ_OPERATIONAL'],
        risk: 'LOW',
        autonomy: 'AUTO_REPLY_ALLOWED',
        sourceReference,
      });
    }
  }
  return chunks;
}

function buildMenuChunks(
  source: CanonicalKnowledgeSourceRegistryRow,
  text: string,
): readonly KnowledgeBaseChunkSeed[] {
  const sourceReference = `${source.title} — Drive ID ${source.driveId}`;
  const rows = parseCsv(text);
  const [header, ...body] = rows;
  if (!header) return [];
  const normalizedHeaders = header.map((value) => normalizeKnowledgePrompt(value));
  const index = new Map(normalizedHeaders.map((name, position) => [name, position] as const));
  const itemIndex = index.get('item');
  const domainIndex = index.get('dominio');
  const categoryIndex = index.get('categoria');
  const descriptionIndex = index.get('descricao');
  const displayPriceIndex = index.get('preco exibido');
  const price1Index = index.get('preco 1');
  const price2Index = index.get('preco 2');
  const statusIndex = index.get('status');
  const idIndex = index.get('id');
  if (itemIndex === undefined || statusIndex === undefined) {
    throw new Error('INSTAGRAM_ENGAGEMENT_KB_MENU_SCHEMA_INVALID');
  }

  const chunks: KnowledgeBaseChunkSeed[] = [];
  for (const row of body) {
    const status = valueAt(row, statusIndex).toUpperCase();
    if (status !== 'ATIVO' && status !== 'ACTIVE') continue;
    const item = valueAt(row, itemIndex);
    if (!item) continue;
    const domain = valueAt(row, domainIndex);
    const category = valueAt(row, categoryIndex);
    const description = valueAt(row, descriptionIndex);
    const displayPrice = valueAt(row, displayPriceIndex);
    const price1 = valueAt(row, price1Index);
    const price2 = valueAt(row, price2Index);
    const rawId = valueAt(row, idIndex) || String(chunks.length + 1);
    const price = displayPrice || formatStructuredPrice(price1, price2);
    const parts = [`${item}${category ? ` (${category})` : ''}`];
    if (description) parts.push(description);
    if (price) parts.push(`Preço vigente exibido no cardápio: ${price}`);
    const content = sentence(parts.join('. '));
    chunks.push({
      stableKey: `menu-item-${rawId}-${item}`,
      heading: item,
      content,
      searchText: `${item} ${domain} ${category} ${description} preço preco valor cardapio cardápio menu drink bebida comida petisco gastronomia ${price}`,
      intentHints: ['FAQ_OPERATIONAL'],
      risk: 'LOW',
      autonomy: 'AUTO_REPLY_ALLOWED',
      sourceReference,
    });
  }
  return chunks;
}

function buildLocationChunks(
  source: CanonicalKnowledgeSourceRegistryRow,
  text: string,
): readonly KnowledgeBaseChunkSeed[] {
  const sourceReference = `${source.title} — Drive ID ${source.driveId}`;
  const location = fieldFromLine(text, 'Localização:');
  if (!location) return [];
  return [
    {
      stableKey: 'general-location',
      heading: 'Localização geral da Toca do Morcego',
      content: `A Toca do Morcego fica em ${stripTerminalPunctuation(location)}. Para a rota exata até a entrada, use o endereço disponível nos canais oficiais da Toca.`,
      searchText: `onde fica localização localizacao endereco endereço como chegar toca do morcego morro de sao paulo são paulo bahia ${location}`,
      intentHints: ['LOCATION_HOURS'],
      risk: 'LOW',
      autonomy: 'AUTO_REPLY_ALLOWED',
      sourceReference,
    },
  ];
}

function buildBrandChunks(
  source: CanonicalKnowledgeSourceRegistryRow,
  text: string,
): readonly KnowledgeBaseChunkSeed[] {
  const sourceReference = `${source.title} — Drive ID ${source.driveId}`;
  const purposeConfirmed = text.includes(
    'Existimos para criar momentos que façam as pessoas se sentirem mais vivas.',
  );
  const celebrateConfirmed = text.includes('Celebrar a Vida.') || text.includes('CELEBRAR A VIDA.');
  const notJustVenueConfirmed = text.includes(
    'A Toca do Morcego não existe apenas para oferecer entretenimento',
  );
  if (!purposeConfirmed || !celebrateConfirmed || !notJustVenueConfirmed) return [];

  return [
    {
      stableKey: 'brand-purpose',
      heading: 'Propósito da Toca do Morcego',
      content:
        'O propósito da Toca é criar momentos que façam as pessoas se sentirem mais vivas. “Celebrar a Vida” é a ideia-mãe da marca: viver o presente com presença, conexão, beleza e emoção.',
      searchText:
        'toca do morcego propósito proposito por que existe celebrar a vida ideia missão missao marca experiência experiencia',
      intentHints: ['GENERAL_SOCIAL'],
      risk: 'LOW',
      autonomy: 'AUTO_REPLY_ALLOWED',
      sourceReference,
    },
    {
      stableKey: 'brand-definition',
      heading: 'O que é a Toca do Morcego',
      content:
        'A Toca do Morcego é uma marca de experiências em Morro de São Paulo. Sua proposta conecta natureza, música, gastronomia, drinks, hospitalidade e pessoas; bar, restaurante, festa ou ponto turístico são partes da operação, não a definição completa da marca.',
      searchText:
        'o que e toca do morcego que lugar marca experiências morro de sao paulo bar restaurante balada casa noturna natureza musica gastronomia drinks hospitalidade',
      intentHints: ['GENERAL_SOCIAL'],
      risk: 'LOW',
      autonomy: 'AUTO_REPLY_ALLOWED',
      sourceReference,
    },
  ];
}

function buildProductsChunks(
  source: CanonicalKnowledgeSourceRegistryRow,
  text: string,
): readonly KnowledgeBaseChunkSeed[] {
  const sourceReference = `${source.title} — Drive ID ${source.driveId}`;
  const requiredMarkers = [
    '01_SUNSET',
    '02_THE_PARTY',
    '03_EVENTOS_ESPECIAIS',
    '04_GASTRONOMIA',
    '05_EVENTOS_PRIVADOS',
    '06_NOVOS_PRODUTOS',
  ];
  if (!requiredMarkers.every((marker) => text.includes(marker))) return [];

  return [
    {
      stableKey: 'portfolio-overview',
      heading: 'Experiências da Toca do Morcego',
      content:
        'A Toca reúne Sunset, The Party, eventos especiais e gastronomia em seu portfólio de experiências. Eventos privados existem sob contratação e briefing; datas, preços, artistas e disponibilidade precisam de fonte atual.',
      searchText:
        'o que tem na toca produtos experiências experiencias portfolio sunset the party festa eventos especiais gastronomia eventos privados',
      intentHints: ['GENERAL_SOCIAL', 'EVENT_INFO'],
      risk: 'LOW',
      autonomy: 'AUTO_REPLY_ALLOWED',
      sourceReference,
    },
    {
      stableKey: 'sunset-experience',
      heading: 'Experiência Sunset',
      content:
        'O Sunset é uma experiência central da Toca de contemplação, música, gastronomia, drinks, encontros e memória, com a natureza e o pôr do sol como parte da experiência.',
      searchText:
        'o que e sunset como e sunset experiência experiencia por do sol contemplação contemplacao musica gastronomia drinks encontros',
      intentHints: ['EVENT_INFO'],
      risk: 'LOW',
      autonomy: 'AUTO_REPLY_ALLOWED',
      sourceReference,
    },
    {
      stableKey: 'the-party-experience',
      heading: 'Experiência The Party',
      content:
        'A The Party é o produto noturno de maior energia da Toca, ligado a música, desejo e celebração. Line-up, edição, data especial e demais fatos variáveis precisam de programação vigente.',
      searchText:
        'o que e the party como e festa balada toca produto noturno musica energia celebração celebracao',
      intentHints: ['EVENT_INFO'],
      risk: 'LOW',
      autonomy: 'AUTO_REPLY_ALLOWED',
      sourceReference,
    },
    {
      stableKey: 'special-events',
      heading: 'Eventos especiais da Toca',
      content:
        'Eventos especiais fazem parte do portfólio da Toca como experiências extraordinárias, sazonais ou temáticas e não constituem, por si só, um produto permanente. Datas e detalhes devem ser confirmados na programação oficial vigente.',
      searchText:
        'eventos especiais festa especial tematica temática sazonal programação programacao agenda',
      intentHints: ['EVENT_INFO'],
      risk: 'LOW',
      autonomy: 'AUTO_REPLY_ALLOWED',
      sourceReference,
    },
    {
      stableKey: 'gastronomy-experience',
      heading: 'Gastronomia na experiência Toca',
      content:
        'A gastronomia faz parte do portfólio e da experiência da Toca. Itens e valores disponíveis devem ser consultados no cardápio oficial vigente.',
      searchText:
        'gastronomia comida restaurante pratos petiscos menu cardapio cardápio experiência toca',
      intentHints: ['FAQ_OPERATIONAL', 'GENERAL_SOCIAL'],
      risk: 'LOW',
      autonomy: 'AUTO_REPLY_ALLOWED',
      sourceReference,
    },
  ];
}

function sourceKind(sourceId: string): InstagramKnowledgeSourceKind {
  if (sourceId === 'SRC-OPS-001') return 'OPERATIONS';
  if (sourceId === 'SRC-MENU-002') return 'MENU_STRUCTURED';
  if (sourceId === 'SRC-LOC-001') return 'LOCATION';
  if (sourceId === 'SRC-BRAND-001') return 'BRAND';
  if (sourceId === 'SRC-PROD-001') return 'PRODUCTS';
  if (sourceId === 'SRC-POL-001') return 'POLICY';
  return 'OTHER';
}

function bulletValue(text: string, prefix: string): string | undefined {
  const line = text
    .split(/\r?\n/)
    .map((value) => value.trim())
    .find((value) => value.toUpperCase().startsWith(prefix.toUpperCase()));
  return line ? line.slice(prefix.length).trim().replace(/\.$/, '') : undefined;
}

function lineContaining(text: string, needle: string): string | undefined {
  return text
    .split(/\r?\n/)
    .map((value) => value.trim())
    .find((value) => value.includes(needle));
}

function fieldFromLine(text: string, prefix: string): string | undefined {
  const line = text
    .split(/\r?\n/)
    .map((value) => value.trim())
    .find((value) => value.toUpperCase().startsWith(prefix.toUpperCase()));
  return line ? line.slice(prefix.length).trim() : undefined;
}

function parseCsv(text: string): readonly (readonly string[])[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index] ?? '';
    if (char === '"') {
      if (quoted && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if (char === ',' && !quoted) {
      row.push(field.trim());
      field = '';
      continue;
    }
    if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && text[index + 1] === '\n') index += 1;
      row.push(field.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      field = '';
      continue;
    }
    field += char;
  }
  row.push(field.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

function formatStructuredPrice(price1: string, price2: string): string {
  if (price1 && price2) return `R$ ${price1} / R$ ${price2}`;
  if (price1) return /^R\$/i.test(price1) ? price1 : `R$ ${price1}`;
  if (price2) return /^R\$/i.test(price2) ? price2 : `R$ ${price2}`;
  return '';
}

function sentence(value: string): string {
  const clean = value.replace(/\s+/g, ' ').trim();
  return /[.!?]$/.test(clean) ? clean : `${clean}.`;
}

function stripTerminalPunctuation(value: string): string {
  return value.trim().replace(/[.;:,]+$/, '');
}

function cell(row: readonly unknown[], index: ReadonlyMap<string, number>, key: string): string {
  const position = index.get(key);
  return position === undefined ? '' : scalar(row[position]);
}

function valueAt(row: readonly string[], index: number | undefined): string {
  return index === undefined ? '' : (row[index] ?? '').trim();
}

function scalar(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value).trim();
  }
  return '';
}
