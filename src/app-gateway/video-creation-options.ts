import type { VideoCreationOptionDefinition, VideoCreationRoute } from './contracts.js';

export const VIDEO_CREATION_OPTIONS: readonly VideoCreationOptionDefinition[] = [
  {
    route: 'REAL_FOOTAGE_FILM',
    manualOrder: 1,
    title: 'Filme com footage real',
    description:
      'Edição cinematográfica com vídeos reais já captados para factualidade, energia e autenticidade.',
    availabilityLabel: 'DISPONIVEL',
    sourceBinding: true,
    generative: false,
    restricted: false,
    bestUse: 'Reels hero e vídeos factuais com crowd, DJ, drone, bar, venue ou atmosfera.',
    driftRisk: 'BAIXO',
    requiresCoverageEvidence: true,
  },
  {
    route: 'PHOTO_MOTION',
    manualOrder: 2,
    title: 'Photo motion',
    description:
      'Anima fotografia real com movimento de câmera, parallax, crop e motion determinístico.',
    availabilityLabel: 'DISPONIVEL',
    sourceBinding: true,
    generative: false,
    restricted: false,
    bestUse: 'Teasers e stories quando há boas fotos reais, mas pouco movimento bruto.',
    driftRisk: 'BAIXO',
    requiresCoverageEvidence: true,
  },
  {
    route: 'IMAGE_TO_VIDEO_SOURCE_BOUND',
    manualOrder: 3,
    title: 'Image-to-video source-bound',
    description:
      'Expande uma foto real em movimento generativo sem inventar marca, local ou fatos.',
    availabilityLabel: 'DISPONIVEL',
    sourceBinding: true,
    generative: true,
    restricted: false,
    bestUse: 'Movimento plausível a partir de foto real preservando rostos, arquitetura e logos.',
    driftRisk: 'MEDIO',
    requiresCoverageEvidence: true,
  },
  {
    route: 'MULTI_SHOT_SOURCE_BOUND',
    manualOrder: 4,
    title: 'Multi-shot source-bound',
    description: 'Combina várias fontes reais em sequência generativa coerente por shot.',
    availabilityLabel: 'DISPONIVEL',
    sourceBinding: true,
    generative: true,
    restricted: false,
    bestUse: 'Filmes generativos em múltiplos shots com assets reais distintos por função narrativa.',
    driftRisk: 'MEDIO',
    requiresCoverageEvidence: true,
  },
  {
    route: 'HYBRID_GENERATIVE_EDITORIAL',
    manualOrder: 5,
    title: 'Híbrido generativo + editorial',
    description:
      'IA cria movimento; branding, texto, CTA e composição final entram deterministicamente.',
    availabilityLabel: 'DISPONIVEL',
    sourceBinding: true,
    generative: true,
    restricted: false,
    bestUse: 'Branding premium com movimento gerado e finalização editorial governada.',
    driftRisk: 'BAIXO_MEDIO',
    requiresCoverageEvidence: true,
  },
  {
    route: 'DIRECTORS_CUT_RECUT',
    manualOrder: 6,
    title: "Director's Cut / Recut",
    description: 'Reedita masters e footage existentes antes de gerar qualquer material novo.',
    availabilityLabel: 'DISPONIVEL',
    sourceBinding: true,
    generative: false,
    restricted: false,
    bestUse: 'Correção, nova narrativa, novo ritmo ou variação de masters já existentes.',
    driftRisk: 'BAIXO',
    requiresCoverageEvidence: true,
  },
  {
    route: 'EDITORIAL_MOTION',
    manualOrder: 7,
    title: 'Editorial motion',
    description:
      'Tipografia, máscara, light wipe, linhas, crops, reveals e ritmo sem nova geração.',
    availabilityLabel: 'DISPONIVEL',
    sourceBinding: true,
    generative: false,
    restricted: false,
    bestUse: 'Motion design rápido e premium sem criar cena nova.',
    driftRisk: 'BAIXO',
    requiresCoverageEvidence: true,
  },
  {
    route: 'DUAL_TRACK_FILM',
    manualOrder: 8,
    title: 'Dual Track Film',
    description:
      'Narrativa para experiências paralelas, como Pista Nacional x Internacional, sem virar slideshow.',
    availabilityLabel: 'DISPONIVEL',
    sourceBinding: true,
    generative: false,
    restricted: false,
    bestUse: 'Mostrar duas experiências em paralelo com arco único e coerente.',
    driftRisk: 'BAIXO_MEDIO',
    requiresCoverageEvidence: true,
  },
  {
    route: 'SPOTLIGHT_MONOTHEMATIC',
    manualOrder: 9,
    title: 'Spotlight monotemático',
    description:
      'Filme centrado em DJ, artista, crowd, drinks, venue, drone, fogo, lifestyle ou outro foco.',
    availabilityLabel: 'DISPONIVEL',
    sourceBinding: true,
    generative: false,
    restricted: false,
    bestUse: 'Um único foco narrativo domina o filme e orienta seleção de takes.',
    driftRisk: 'VARIAVEL',
    requiresCoverageEvidence: true,
  },
  {
    route: 'SYNTHETIC_TEXT_TO_VIDEO_RESTRICTED',
    manualOrder: 10,
    title: 'Text-to-video sintético',
    description:
      'Somente para usos não factuais ou abstratos; não substitui footage real do local/evento.',
    availabilityLabel: 'RESTRITO',
    sourceBinding: false,
    generative: true,
    restricted: true,
    bestUse: 'Cenas abstratas, não factuais e sem promessa visual do local, artista ou evento real.',
    driftRisk: 'ALTO',
    requiresCoverageEvidence: false,
  },
];

export function listVideoCreationOptions(): readonly VideoCreationOptionDefinition[] {
  return VIDEO_CREATION_OPTIONS;
}

export function getVideoCreationOption(route: VideoCreationRoute): VideoCreationOptionDefinition {
  const option = VIDEO_CREATION_OPTIONS.find((candidate) => candidate.route === route);
  if (!option) throw new Error(`VIDEO_CREATION_ROUTE_NOT_CATALOGUED:${route}`);
  return option;
}
