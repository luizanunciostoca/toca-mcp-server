import type { ActionCardDefinition } from './contracts.js';

export const ACTION_CARD_CATALOG: readonly ActionCardDefinition[] = [
  {
    actionType: 'CREATE_CONTENT',
    title: 'Criar conteúdo',
    description: 'Stories, Feed, Carrossel, Reels, vídeo e peças de campanha.',
    defaultMode: 'AUTO',
    requirement: {
      allOf: ['system.capabilities'],
      anyOf: [
        'design.brief.create',
        'copy.generate',
        'editorial.story_sequence.plan',
        'video.select_assets',
      ],
    },
  },
  {
    actionType: 'CREATE_VIDEO',
    title: 'Criar vídeo',
    description:
      'Footage real, photo motion, source-bound, recut, motion editorial e rotas restritas.',
    defaultMode: 'AUTO',
    requirement: {
      allOf: ['system.capabilities'],
      anyOf: ['video.select_assets'],
    },
  },
  {
    actionType: 'PLAN_CONTENT',
    title: 'Planejar conteúdo',
    description: 'Calendário, campanha, sequência editorial e cobertura de eventos.',
    defaultMode: 'AUTO',
    requirement: {
      allOf: ['system.capabilities'],
      anyOf: ['editorial.calendar.generate', 'campaign.content.plan'],
    },
  },
  {
    actionType: 'PUBLISH_SCHEDULE',
    title: 'Publicar / Agendar',
    description: 'Preparar, agendar, publicar, reconciliar ou cancelar conteúdo autorizado.',
    defaultMode: 'GUIDED',
    requirement: {
      allOf: ['system.capabilities'],
      anyOf: ['instagram.toca_schedule.create', 'instagram.publication.publish'],
    },
  },
  {
    actionType: 'META_ADS',
    title: 'Meta Ads',
    description: 'Diagnóstico, planejamento, criação controlada e performance de campanhas.',
    defaultMode: 'GUIDED',
    requirement: {
      allOf: ['system.capabilities'],
      anyOf: ['meta_ads.campaigns.list', 'meta_ads.campaign.prepare_paused'],
    },
  },
  {
    actionType: 'SOCIAL_INBOX',
    title: 'Atender clientes',
    description: 'Comentários, Directs, leads, classificação, respostas e escalonamentos.',
    defaultMode: 'GUIDED',
    requirement: {
      allOf: ['system.capabilities'],
      anyOf: ['social.comments.list', 'social.directs.list'],
    },
  },
  {
    actionType: 'MEDIA_LIBRARY',
    title: 'Fotos e vídeos',
    description: 'Buscar, ranquear, tratar, selecionar e acompanhar ativos de mídia.',
    defaultMode: 'AUTO',
    requirement: {
      allOf: ['system.capabilities'],
      anyOf: ['media.scan', 'media.rank', 'video.select_assets'],
    },
  },
  {
    actionType: 'ANALYTICS',
    title: 'Analisar resultados',
    description: 'Instagram, mídia, campanhas, comparação de períodos e recomendações.',
    defaultMode: 'AUTO',
    requirement: {
      allOf: ['system.capabilities'],
      anyOf: ['instagram.insights.account', 'meta_ads.insights.get'],
    },
  },
  {
    actionType: 'COMMERCIAL',
    title: 'Comercial',
    description: 'Leads, propostas, patrocínios, parceiros, follow-ups e pipeline.',
    defaultMode: 'GUIDED',
    requirement: {
      allOf: ['system.capabilities'],
      anyOf: ['sales.lead.create', 'sales.proposal.generate'],
    },
  },
  {
    actionType: 'OPERATIONS',
    title: 'Operação / Eventos',
    description: 'Abertura, fechamento, checklists, prontidão de eventos e incidentes.',
    defaultMode: 'GUIDED',
    requirement: {
      allOf: ['system.capabilities'],
      anyOf: ['operations.opening.status', 'operations.event.readiness'],
    },
  },
  {
    actionType: 'DOCUMENTS',
    title: 'Documentos',
    description: 'Apresentações, relatórios e materiais operacionais governados.',
    defaultMode: 'AUTO',
    requirement: {
      allOf: ['system.capabilities'],
      anyOf: ['presentation.brief.create', 'presentation.slides.generate'],
    },
  },
];
