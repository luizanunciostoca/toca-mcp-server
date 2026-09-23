export const THE_PARTY_ITACARE_1011_ACCOUNT_ID = '311793958882290';
export const THE_PARTY_ITACARE_1011_CAMPAIGN_ID = '52622846509265';
export const THE_PARTY_ITACARE_1011_CURRENCY = 'BRL';
export const THE_PARTY_ITACARE_1011_PIXEL_ID = '461233076843065';
export const THE_PARTY_ITACARE_1011_PAGE_ID = '306103746115875';
export const THE_PARTY_ITACARE_1011_INSTAGRAM_USER_ID = '17841402033495654';
export const THE_PARTY_ITACARE_1011_DESTINATION_URL =
  'https://www.sympla.com.br/evento/the-party-exclusive-itacare/3569762';
export const THE_PARTY_ITACARE_1011_END_TIME = '2026-10-11T18:00:00-0700';

export interface ThePartyItacareFeedAsset {
  readonly code: string;
  readonly fileName: string;
  readonly sha256: string;
  readonly headline: string;
  readonly description: string;
}

export interface ThePartyItacareFeedCity {
  readonly code: string;
  readonly displayName: string;
  readonly sourceAdSetId: string;
  readonly lifetimeBudgetMinor: number;
  readonly location: Readonly<Record<string, unknown>>;
  readonly primaryTexts: readonly [string, string, string, string, string];
}

export const THE_PARTY_ITACARE_1011_FEED_ASSETS: readonly ThePartyItacareFeedAsset[] = [
  {
    code: 'C01_MARCA',
    fileName: 'creative-01-marca.jpg',
    sha256: '156d87d1045efacdeaa4e9de17e33a74ab2645b7a49124e25eacd471b0f7ea85',
    headline: 'THE PARTY OF ITACARÉ • 11/10',
    description: 'Illusionize + Brisotti • Praia da Ribeira',
  },
  {
    code: 'C02_DATA',
    fileName: 'creative-02-data.jpg',
    sha256: 'ea9b7d263906ab62bdae043ab385d5d13e73065cf2e339e7fe44d82b43909693',
    headline: '11 DE OUTUBRO • ITACARÉ',
    description: 'The Party of Itacaré',
  },
  {
    code: 'C03_LINEUP',
    fileName: 'creative-03-lineup.jpg',
    sha256: '31cf4408c8100026115131b270b54b27487d06eee68f251389abb87f9f2f911e',
    headline: 'ILLUSIONIZE + BRISOTTI EM ITACARÉ',
    description: '11 de outubro • Praia da Ribeira',
  },
  {
    code: 'C04_ILLUSIONIZE',
    fileName: 'creative-04-illusionize.jpg',
    sha256: 'fe75d300b3ab86de009a120a1ca8725c4b032defe6c37d7b949cbb6423558b02',
    headline: 'ILLUSIONIZE • 11/10 • ITACARÉ',
    description: 'The Party of Itacaré',
  },
  {
    code: 'C05_LOTE',
    fileName: 'creative-05-lote.jpg',
    sha256: 'e0d0fad62b05477a49e9efecaa78e9f3b212f44b6af544db8afb9350103b4ae4',
    headline: 'GARANTA ANTES DA MUDANÇA DE LOTE',
    description: 'The Party of Itacaré • 11 de outubro',
  },
] as const;

export const THE_PARTY_ITACARE_1011_FEED_CITIES: readonly ThePartyItacareFeedCity[] = [
  {
    code: 'ITACARE',
    displayName: 'ITACARÉ',
    sourceAdSetId: '52625517764465',
    lifetimeBudgetMinor: 46486,
    location: {
      distance_unit: 'kilometer',
      latitude: -14.27834,
      longitude: -38.99306,
      radius: 15,
      primary_city_id: 255575,
      region_id: 442,
      country: 'BR',
    },
    primaryTexts: [
      'Itacaré tem noites especiais. E tem noites que viram história. Dia 11 de outubro, a Praia da Ribeira recebe Illusionize + Brisotti para a The Party of Itacaré. Música, natureza, liberdade e conexões no mesmo lugar. Não é qualquer festa. É A festa. Garanta seu ingresso.',
      '11 DE OUTUBRO. Salva essa data. Illusionize + Brisotti na Praia da Ribeira, em Itacaré. The Party of Itacaré. Garanta seu ingresso.',
      'Dois nomes. Um beach club. Uma noite em Itacaré. ILLUSIONIZE + BRISOTTI, dia 11 de outubro, na Praia da Ribeira. Essa combinação você precisa viver de perto. Garanta seu ingresso.',
      'ILLUSIONIZE EM ITACARÉ. Agora tem data: 11 de outubro. Praia da Ribeira. The Party of Itacaré. Uma noite para viver de perto. Garanta seu ingresso.',
      'Se você já decidiu que vai, não deixe para depois. Os lotes avançam e o dia 11 de outubro está chegando. Illusionize + Brisotti, Praia da Ribeira, The Party of Itacaré. Garanta seu ingresso.',
    ],
  },
  {
    code: 'ILHEUS',
    displayName: 'ILHÉUS',
    sourceAdSetId: '52625517791665',
    lifetimeBudgetMinor: 46433,
    location: {
      distance_unit: 'kilometer',
      latitude: -14.79895,
      longitude: -39.03255,
      radius: 15,
      primary_city_id: 255098,
      region_id: 442,
      country: 'BR',
    },
    primaryTexts: [
      'Ilhéus, no dia 11 de outubro o destino é Itacaré. Praia da Ribeira, beach club, Illusionize + Brisotti e uma noite inteira para sair da rotina. Tem festa que você vai. E tem festa que vale a viagem. Não é qualquer festa. É A festa. Garanta seu ingresso.',
      '11 de outubro tem destino: Itacaré. Illusionize + Brisotti na Praia da Ribeira. Chame sua turma de Ilhéus e programe a viagem. Ingressos disponíveis.',
      'Uma noite dessas está mais perto do que parece. Saia de Ilhéus para viver Illusionize + Brisotti na Praia da Ribeira, em Itacaré. Dia 11 de outubro. Monte a turma e garanta seu ingresso.',
      'Ilhéus, Illusionize está a uma viagem de distância. Dia 11 de outubro, o destino é a Praia da Ribeira, em Itacaré. Garanta seu ingresso para a The Party.',
      'Ilhéus, se Itacaré já está nos planos do feriado, resolva o ingresso agora. Os lotes avançam e a The Party acontece dia 11 de outubro. Garanta seu ingresso.',
    ],
  },
  {
    code: 'ITABUNA',
    displayName: 'ITABUNA',
    sourceAdSetId: '52625517808465',
    lifetimeBudgetMinor: 47249,
    location: {
      distance_unit: 'kilometer',
      latitude: -14.79219,
      longitude: -39.27558,
      radius: 15,
      primary_city_id: 255568,
      region_id: 442,
      country: 'BR',
    },
    primaryTexts: [
      'Itabuna → Itacaré. Já pode colocar essa rota nos planos do feriado. Illusionize + Brisotti, Praia da Ribeira e uma noite inteira no beach club. Dia 11 de outubro. Não é qualquer festa. É A festa. Garanta seu ingresso.',
      '11/10: Itabuna → Itacaré. Illusionize + Brisotti. Praia da Ribeira. The Party. Seu feriado já tem uma noite marcada. Garanta seu ingresso.',
      'Itabuna, prepare a turma. Illusionize + Brisotti esperam por você em Itacaré no dia 11 de outubro. Praia, beach club e pista até a madrugada. Garanta seu ingresso.',
      'Itabuna, marque 11 de outubro. O destino é Itacaré. Illusionize chega à Praia da Ribeira para a The Party. Garanta seu ingresso.',
      'Itabuna, não espere todo mundo decidir para garantir o seu. Os lotes avançam e o dia 11 de outubro está chegando. Garanta seu ingresso para a The Party of Itacaré.',
    ],
  },
  {
    code: 'VITORIA_DA_CONQUISTA',
    displayName: 'VITÓRIA DA CONQUISTA',
    sourceAdSetId: '52625517833865',
    lifetimeBudgetMinor: 48070,
    location: {
      distance_unit: 'kilometer',
      latitude: -14.8661,
      longitude: -40.8394,
      radius: 15,
      primary_city_id: 274411,
      region_id: 442,
      country: 'BR',
    },
    primaryTexts: [
      'Vitória da Conquista → Itacaré. Seu feriado tem destino. Dia 11 de outubro, Illusionize + Brisotti chegam à Praia da Ribeira para a The Party. Não é qualquer festa. É A festa. Garanta seu ingresso.',
      '11 de outubro: Vitória da Conquista → Itacaré. Illusionize + Brisotti, Praia da Ribeira e The Party. Chame sua turma e programe a viagem. Garanta seu ingresso.',
      'Conquista, prepare a turma. Illusionize + Brisotti esperam por você em Itacaré no dia 11 de outubro. Praia da Ribeira, beach club e uma noite para viver de perto. Garanta seu ingresso.',
      'Vitória da Conquista, marque 11 de outubro. Illusionize está em Itacaré, na Praia da Ribeira, para a The Party. Garanta seu ingresso.',
      'Conquista, se Itacaré está nos planos, não deixe o ingresso para depois. Os lotes avançam e o dia 11 de outubro está chegando. Garanta seu ingresso.',
    ],
  },
] as const;

export function buildThePartyItacare1011Targeting(city: ThePartyItacareFeedCity) {
  return {
    age_min: 18,
    age_max: 35,
    targeting_automation: {
      advantage_audience: 0,
    },
    publisher_platforms: ['facebook', 'instagram'],
    facebook_positions: ['feed'],
    instagram_positions: ['stream'],
    geo_locations: {
      custom_locations: [city.location],
      location_types: ['frequently_in', 'home', 'recent'],
    },
  };
}
