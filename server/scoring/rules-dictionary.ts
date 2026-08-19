/**
 * VERBATIM PORT — do not edit thresholds/weights/labels here without checking
 * the source of truth first:
 *   brandstash-app/api/src/gbp/utils/rules-dictionary.ts  (RULES_VERSION 1.3.0)
 *
 * Versioned, deterministic dictionaries for the GBP rules engine. Everything
 * here is pure data: thresholds, weights and recommendation templates.
 * Scoring stays on the Brandstash 0–10 scale (with decimals).
 */

export const RULES_VERSION = '1.3.0'

export type CategoryKey =
  | 'fotos'
  | 'avaliacoes'
  | 'horarios'
  | 'descricao'
  | 'website'
  | 'telefone'
  | 'categorias'
  | 'status'

export type CategoryStatus = 'bom' | 'precisa_melhorar' | 'ausente'

/** Fixed evaluation order — also the deterministic tiebreaker for prioritization. */
export const CATEGORY_ORDER: readonly CategoryKey[] = [
  'fotos',
  'avaliacoes',
  'horarios',
  'descricao',
  'website',
  'telefone',
  'categorias',
  'status',
] as const

export const CATEGORY_LABELS: Record<CategoryKey, string> = {
  fotos: 'Fotos',
  avaliacoes: 'Avaliações',
  horarios: 'Horários',
  descricao: 'Descrição',
  website: 'Website',
  telefone: 'Telefone',
  categorias: 'Categorias',
  status: 'Status',
}

/** `fotos` and `avaliacoes` weigh 2× in the overall score (legacy parity). */
export const CATEGORY_WEIGHTS: Record<CategoryKey, number> = {
  fotos: 2,
  avaliacoes: 2,
  horarios: 1,
  descricao: 1,
  website: 1,
  telefone: 1,
  categorias: 1,
  status: 1,
}

export const MAX_CATEGORY_SCORE = 10

/**
 * Photo count thresholds (inclusive lower bounds). The Places API caps photos
 * at 10, so the score is reachable within the cap: `≥5 → bom`,
 * `1–4 → precisa_melhorar`, `0 → ausente`.
 */
export const PHOTO_THRESHOLDS = {
  bom: 5,
  precisa_melhorar: 1,
} as const

/** Review rating/count thresholds. */
export const REVIEW_THRESHOLDS = {
  minCount: 50,
  goodRating: 4.0,
  weakRating: 3.0,
} as const

/** Minimum editorial summary length (chars) considered "useful" (legacy). */
export const DESCRIPTION_MIN_USEFUL_LENGTH = 100

/**
 * Deterministic, multi-criteria description scoring. Each criterion yields a
 * 0..1 sub-score; the weighted sum (×10) is the `descricao` score. When a
 * criterion is not applicable (e.g. `keywords` without niche terms) its weight
 * is excluded and the remaining weights renormalized.
 */
export const DESCRIPTION_LENGTH = { idealMin: 250, idealMax: 750 } as const

export const DESCRIPTION_CRITERION_WEIGHTS = {
  length: 0.25,
  keywords: 0.2,
  density: 0.15,
  prohibited: 0.2,
  readability: 0.2,
} as const

export type DescriptionCriterion = keyof typeof DESCRIPTION_CRITERION_WEIGHTS

/** Status thresholds for the weighted description score (0–10). */
export const DESCRIPTION_SCORE_THRESHOLDS = { bom: 8, precisa_melhorar: 4 } as const

/** Readability: words/sentence at/under `ideal` is best; `hard` floors the score. */
export const DESCRIPTION_READABILITY = { idealWordsPerSentence: 20, hardWordsPerSentence: 60 } as const

/** Lexical density (unique/total words) considered good; needs a minimum sample. */
export const DESCRIPTION_DENSITY = { goodRatio: 0.6, minWords: 12 } as const

/** Patterns Google disallows / discourages in the description. */
export const DESCRIPTION_PROHIBITED = {
  url: /(https?:\/\/|www\.)\S+|\b[\w-]+\.(com|com\.br|br|net|org|io|app)\b/i,
  phone: /(\+?\d[\d().\s-]{7,}\d)/,
  emoji: /\p{Extended_Pictographic}/gu,
  maxEmojis: 2,
} as const

/** Stopwords dropped when deriving niche keywords from the briefing. */
export const KEYWORD_STOPWORDS: ReadonlySet<string> = new Set([
  'para',
  'com',
  'que',
  'uma',
  'dos',
  'das',
  'nas',
  'nos',
  'por',
  'mais',
  'como',
  'sua',
  'seu',
  'sem',
  'the',
  'and',
  'for',
  'voce',
  'nossa',
  'nosso',
  'todos',
  'todas',
  'qualidade',
])

/** Number of priority actions surfaced (legacy parity = 3). */
export const PRIORITY_ACTIONS_COUNT = 3

/**
 * Recommendation templates per category × resolved status. Canonical Brandstash
 * (Portuguese) strings — the email/UI localize at the presentation layer, the
 * engine output stays byte-identical to Brandstash.
 */
export const RECOMMENDATIONS: Record<CategoryKey, Record<CategoryStatus, string>> = {
  fotos: {
    bom: 'Boa presença de fotos. Mantenha o perfil atualizado com imagens recentes do exterior, interior, equipe e produtos.',
    precisa_melhorar:
      'Adicione mais fotos cobrindo exterior, interior, equipe e produtos para reforçar a credibilidade do perfil.',
    ausente:
      'O perfil não tem fotos. Adicione imagens do exterior, interior, equipe e produtos — perfis com fotos recebem mais visualizações.',
  },
  avaliacoes: {
    bom: 'Boa reputação. Continue solicitando avaliações e respondendo aos clientes para manter o engajamento.',
    precisa_melhorar:
      'Incentive clientes satisfeitos a deixarem avaliações e responda às existentes. Volume e nota acima de 4,0 aumentam a confiança.',
    ausente:
      'O perfil ainda não tem avaliações. Crie um fluxo para solicitar avaliações de clientes — elas são decisivas na escolha local.',
  },
  horarios: {
    bom: 'Horário de funcionamento configurado. Revise periodicamente, especialmente em feriados.',
    precisa_melhorar:
      'Complete o horário de funcionamento para todos os dias da semana, incluindo exceções de feriados.',
    ausente:
      'Nenhum horário de funcionamento configurado. Adicione os horários — clientes filtram por estabelecimentos abertos agora.',
  },
  descricao: {
    bom: 'Descrição presente e informativa. Mantenha-a alinhada ao posicionamento atual do negócio.',
    precisa_melhorar:
      'A descrição é curta. Amplie para explicar o que o negócio oferece, diferenciais e público atendido.',
    ausente:
      'Nenhuma descrição cadastrada. Adicione um resumo claro do negócio, seus serviços e diferenciais.',
  },
  website: {
    bom: 'Website cadastrado. Garanta que o link leve a uma página relevante e funcional.',
    precisa_melhorar: 'Revise o link do website para garantir que esteja correto e ativo.',
    ausente:
      'Nenhum website cadastrado. Adicione o site ou uma landing page — ele aumenta a conversão do perfil.',
  },
  telefone: {
    bom: 'Telefone cadastrado. Confirme que o número está ativo e atende ao público.',
    precisa_melhorar: 'Revise o telefone de contato para garantir que esteja correto.',
    ausente:
      'Nenhum telefone cadastrado. Adicione um número de contato — ele facilita o contato direto do cliente.',
  },
  categorias: {
    bom: 'Categorias bem definidas. Revise periodicamente para refletir todos os serviços oferecidos.',
    precisa_melhorar:
      'Adicione categorias secundárias relevantes para descrever melhor todos os serviços do negócio.',
    ausente:
      'Nenhuma categoria definida. Defina a categoria principal e secundárias adequadas ao segmento do negócio.',
  },
  status: {
    bom: 'Perfil em operação. Nenhuma ação necessária quanto ao status.',
    precisa_melhorar:
      'O status do perfil não está como "Em operação". Confirme a situação real do negócio no Google Business Profile.',
    ausente:
      'O perfil está marcado como fechado. Reative ou atualize o status se o negócio estiver operando.',
  },
}
