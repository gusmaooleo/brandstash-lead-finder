/**
 * PARITY SUITE — ported from:
 *   the product’s rules engine
 *
 * Same representative inputs, same expected statuses/scores. If a change here
 * (or in server/scoring/) diverges from the source, the lead-finder
 * score no longer matches the the profile score — fix the port, not
 * the expectations.
 */

import { describe, expect, it } from 'vitest'
import { analyzePlaceProfile, type RulesAnalysisResult } from './analyze'
import { CATEGORY_ORDER, RULES_VERSION } from './rules-dictionary'
import type { PlaceProfileSummary, ScoringBriefing } from './types'

function makeSummary(overrides: Partial<PlaceProfileSummary> = {}): PlaceProfileSummary {
  return {
    name: 'Test Business',
    address: 'Rua Teste, 123',
    phone: '+55 11 99999-9999',
    website: 'https://test.com',
    rating: 4.6,
    total_ratings: 120,
    has_hours: true,
    hours_text: ['Seg-Sex: 9h-18h'],
    photos_count: 25,
    reviews_count: 80,
    reviews_sample: [{ rating: 5, text: 'Ótimo!' }],
    types: ['restaurant', 'food'],
    // High-quality description: action-verb opening, ideal length, CTA,
    // readable sentences, no prohibited content → scores 10.
    editorial_summary:
      'Oferecemos culinária regional preparada com ingredientes frescos e selecionados, em ambiente acolhedor para famílias. Nossa equipe atende cada cliente com dedicação, criando experiências memoráveis e saborosas. Agende sua mesa, conheça nossos pratos e descubra os sabores autênticos da nossa terra.',
    business_status: 'OPERATIONAL',
    ...overrides,
  }
}

const EMPTY_BRIEFING: ScoringBriefing = {
  businessName: '',
  industry: '',
  differentiators: '',
  targetAudience: '',
}

function getCategory(result: RulesAnalysisResult, key: string) {
  const c = result.categories.find((cat) => cat.category === key)
  if (!c) throw new Error(`category ${key} missing`)
  return c
}

describe('analyzePlaceProfile (rules parity)', () => {
  describe('shape & engine metadata', () => {
    it('returns rules engine metadata and the 8 categories in order', () => {
      const result = analyzePlaceProfile(makeSummary())

      expect(result.analysis_engine).toBe('rules')
      expect(result.rules_version).toBe(RULES_VERSION)
      expect(result.categories.map((c) => c.category)).toEqual([...CATEGORY_ORDER])
      expect(result.priorityActions).toHaveLength(3)
      expect(result.applied_templates).toHaveLength(8)
      expect(Object.keys(result.evidence)).toEqual([...CATEGORY_ORDER])
    })
  })

  describe('reproducibility', () => {
    it('produces identical output for the same input across runs', () => {
      const summary = makeSummary({ photos_count: 14, rating: 3.8, total_ratings: 40 })
      const a = analyzePlaceProfile(summary)
      const b = analyzePlaceProfile(summary)
      const c = analyzePlaceProfile(summary)

      expect(b).toEqual(a)
      expect(c).toEqual(a)
      expect(b.overallScore).toBe(a.overallScore)
      expect(b.priorityActions).toEqual(a.priorityActions)
    })
  })

  describe('fotos thresholds', () => {
    it('5+ photos → bom (score 10)', () => {
      const r = getCategory(analyzePlaceProfile(makeSummary({ photos_count: 5 })), 'fotos')
      expect(r.status).toBe('bom')
      expect(r.score).toBe(10)
    })

    it('10 photos (Places cap) → bom (score 10)', () => {
      const r = getCategory(analyzePlaceProfile(makeSummary({ photos_count: 10 })), 'fotos')
      expect(r.status).toBe('bom')
      expect(r.score).toBe(10)
    })

    it('1–4 photos → precisa_melhorar (score 6)', () => {
      const r = getCategory(analyzePlaceProfile(makeSummary({ photos_count: 3 })), 'fotos')
      expect(r.status).toBe('precisa_melhorar')
      expect(r.score).toBe(6)
    })

    it('zero photos → ausente (score 0) + warning', () => {
      const result = analyzePlaceProfile(makeSummary({ photos_count: 0 }))
      const r = getCategory(result, 'fotos')
      expect(r.status).toBe('ausente')
      expect(r.score).toBe(0)
      expect(result.warnings).toContain('Perfil sem fotos.')
    })
  })

  describe('avaliacoes thresholds', () => {
    it('50+ reviews and rating >= 4.0 → bom', () => {
      const r = getCategory(
        analyzePlaceProfile(makeSummary({ rating: 4.5, total_ratings: 80 })),
        'avaliacoes',
      )
      expect(r.status).toBe('bom')
      expect(r.score).toBe(10)
    })

    it('50+ reviews and rating 3.0–3.9 → precisa_melhorar (7)', () => {
      const r = getCategory(
        analyzePlaceProfile(makeSummary({ rating: 3.5, total_ratings: 80 })),
        'avaliacoes',
      )
      expect(r.status).toBe('precisa_melhorar')
      expect(r.score).toBe(7)
    })

    it('50+ reviews and rating < 3.0 → precisa_melhorar (4)', () => {
      const r = getCategory(
        analyzePlaceProfile(makeSummary({ rating: 2.4, total_ratings: 80 })),
        'avaliacoes',
      )
      expect(r.status).toBe('precisa_melhorar')
      expect(r.score).toBe(4)
    })

    it('fewer than 50 reviews → precisa_melhorar (5)', () => {
      const r = getCategory(
        analyzePlaceProfile(makeSummary({ rating: 4.9, total_ratings: 10 })),
        'avaliacoes',
      )
      expect(r.status).toBe('precisa_melhorar')
      expect(r.score).toBe(5)
    })

    it('no reviews → ausente (0) + warning', () => {
      const result = analyzePlaceProfile(makeSummary({ rating: null, total_ratings: 0 }))
      const r = getCategory(result, 'avaliacoes')
      expect(r.status).toBe('ausente')
      expect(r.score).toBe(0)
      expect(r.value).toBeNull()
      expect(result.warnings).toContain('Perfil sem avaliações.')
    })
  })

  describe('binary & presence categories', () => {
    it('horarios present → bom, absent → ausente', () => {
      expect(
        getCategory(analyzePlaceProfile(makeSummary({ has_hours: true })), 'horarios').status,
      ).toBe('bom')
      expect(
        getCategory(analyzePlaceProfile(makeSummary({ has_hours: false })), 'horarios').status,
      ).toBe('ausente')
    })

    it('descricao: high-quality → bom, weak → precisa_melhorar, empty → ausente', () => {
      expect(getCategory(analyzePlaceProfile(makeSummary()), 'descricao').status).toBe('bom')
      expect(
        getCategory(
          analyzePlaceProfile(makeSummary({ editorial_summary: 'Curta.' })),
          'descricao',
        ).status,
      ).toBe('precisa_melhorar')
      expect(
        getCategory(
          analyzePlaceProfile(makeSummary({ editorial_summary: null })),
          'descricao',
        ).status,
      ).toBe('ausente')
    })

    it('website / telefone binary', () => {
      expect(
        getCategory(analyzePlaceProfile(makeSummary({ website: null })), 'website').status,
      ).toBe('ausente')
      expect(
        getCategory(analyzePlaceProfile(makeSummary({ phone: null })), 'telefone').status,
      ).toBe('ausente')
    })

    it('categorias: 0 → ausente, 1 → precisa_melhorar, 2+ → bom', () => {
      expect(
        getCategory(analyzePlaceProfile(makeSummary({ types: [] })), 'categorias').status,
      ).toBe('ausente')
      expect(
        getCategory(analyzePlaceProfile(makeSummary({ types: ['restaurant'] })), 'categorias')
          .status,
      ).toBe('precisa_melhorar')
      expect(
        getCategory(
          analyzePlaceProfile(makeSummary({ types: ['restaurant', 'bar'] })),
          'categorias',
        ).status,
      ).toBe('bom')
    })
  })

  describe('descricao multi-criteria', () => {
    type DescEvidence = {
      sub_scores: Partial<Record<string, number>>
      weighted_score: number
      niche_keywords: string[]
      matched_keywords: string[]
      violations: { url: boolean; phone: boolean; emojis: number }
      keywords_applied: boolean
    }
    const descEvidence = (result: RulesAnalysisResult): DescEvidence =>
      result.evidence.descricao as DescEvidence

    it('empty description → ausente (0)', () => {
      const r = getCategory(
        analyzePlaceProfile(makeSummary({ editorial_summary: null })),
        'descricao',
      )
      expect(r.status).toBe('ausente')
      expect(r.score).toBe(0)
    })

    it('length: ideal range scores 1, too short scores below 1', () => {
      const ideal = descEvidence(analyzePlaceProfile(makeSummary()))
      expect(ideal.sub_scores.length).toBe(1)
      const short = descEvidence(
        analyzePlaceProfile(makeSummary({ editorial_summary: 'Bom restaurante na cidade.' })),
      )
      expect(short.sub_scores.length).toBeLessThan(1)
    })

    it('keywords: counted only when the briefing supplies niche terms', () => {
      const briefed = analyzePlaceProfile(makeSummary(), {
        ...EMPTY_BRIEFING,
        industry: 'Restaurante',
        differentiators: 'culinária regional autêntica',
      })
      const be = descEvidence(briefed)
      expect(be.keywords_applied).toBe(true)
      expect(be.niche_keywords).toContain('regional')
      expect(be.matched_keywords.length).toBeGreaterThan(0)
      expect(be.sub_scores.keywords).toBeGreaterThan(0)

      const unbriefed = descEvidence(analyzePlaceProfile(makeSummary()))
      expect(unbriefed.keywords_applied).toBe(false)
      expect(unbriefed.sub_scores.keywords).toBeUndefined()
    })

    it('density: highly repetitive text scores low', () => {
      const repetitive =
        'Massa massa massa massa massa massa massa massa massa massa massa massa massa massa.'
      const e = descEvidence(analyzePlaceProfile(makeSummary({ editorial_summary: repetitive })))
      expect(e.sub_scores.density).toBeLessThan(0.5)
    })

    it('prohibited: URL, phone and excess emojis are penalized', () => {
      const url = descEvidence(
        analyzePlaceProfile(
          makeSummary({ editorial_summary: 'Conheça nossos pratos. Acesse www.exemplo.com.br hoje.' }),
        ),
      )
      expect(url.violations.url).toBe(true)
      expect(url.sub_scores.prohibited).toBeLessThan(1)

      const phone = descEvidence(
        analyzePlaceProfile(
          makeSummary({ editorial_summary: 'Agende pelo telefone (11) 99999-9999 e venha conhecer.' }),
        ),
      )
      expect(phone.violations.phone).toBe(true)
      expect(phone.sub_scores.prohibited).toBeLessThan(1)

      const emojis = descEvidence(
        analyzePlaceProfile(
          makeSummary({ editorial_summary: 'Venha! 🍕🍝🥗🍷🎉 Agende sua mesa e aproveite muito.' }),
        ),
      )
      expect(emojis.violations.emojis).toBeGreaterThan(2)
      expect(emojis.sub_scores.prohibited).toBeLessThan(1)
    })

    it('readability: long run-on sentences score lower than short ones', () => {
      const runOn =
        'Oferecemos culinária regional preparada com ingredientes frescos e selecionados em um ambiente acolhedor para toda a família que busca uma experiência completa e memorável com pratos variados servidos diariamente pela nossa equipe dedicada que cuida de cada detalhe sem nunca usar pontuação adequada o que dificulta bastante a leitura corrida'
      const e = descEvidence(analyzePlaceProfile(makeSummary({ editorial_summary: runOn })))
      expect(e.sub_scores.readability).toBeLessThan(1)
    })

    it('is deterministic and renormalizes weights when keywords are absent', () => {
      const a = analyzePlaceProfile(makeSummary())
      const b = analyzePlaceProfile(makeSummary())
      expect(descEvidence(a)).toEqual(descEvidence(b))
      // A flawless description (no briefing) still reaches 10 — the missing
      // keywords weight is redistributed, not counted as a zero.
      expect(getCategory(a, 'descricao').score).toBe(10)
    })
  })

  describe('descricao source resolution', () => {
    it('override: scores the resolved GBP profile description, evidence carries the gbp source tag', () => {
      const result = analyzePlaceProfile(makeSummary(), undefined, {
        text: 'Padaria artesanal do centro histórico, tradição desde 1998.',
        source: 'gbp_profile',
      })
      const cat = getCategory(result, 'descricao')
      expect(cat.value).toBe('Padaria artesanal do centro histórico, tradição desde 1998.')
      expect(cat.sourceLabel).toBe('descrição do perfil (Google Business)')
      expect((result.evidence.descricao as { source: string }).source).toBe('gbp_profile')
    })

    it('no override (lead-finder path): keeps scoring editorial_summary unchanged', () => {
      const withOverride = analyzePlaceProfile(makeSummary())
      const cat = getCategory(withOverride, 'descricao')
      expect(cat.value).toBe(makeSummary().editorial_summary)
      expect(cat.sourceLabel).toBe('resumo editorial do Google')
      expect((withOverride.evidence.descricao as { source: string }).source).toBe(
        'editorial_summary',
      )
    })

    it('empty resolved description + empty editorial summary → status ausente, no fabricated text', () => {
      const result = analyzePlaceProfile(makeSummary({ editorial_summary: null }), undefined, {
        text: '',
        source: 'editorial_summary',
      })
      const cat = getCategory(result, 'descricao')
      expect(cat.status).toBe('ausente')
      expect(cat.value).toBeNull()
    })

    it('is deterministic: same summary + briefing + resolved description ⇒ same result', () => {
      const override = { text: 'Texto estável do perfil.', source: 'gbp_profile' as const }
      const a = analyzePlaceProfile(makeSummary(), EMPTY_BRIEFING, override)
      const b = analyzePlaceProfile(makeSummary(), EMPTY_BRIEFING, override)
      expect(a).toEqual(b)
    })
  })

  describe('status category', () => {
    it('OPERATIONAL → bom', () => {
      expect(getCategory(analyzePlaceProfile(makeSummary()), 'status').status).toBe('bom')
    })

    it('CLOSED_TEMPORARILY → precisa_melhorar + warning', () => {
      const result = analyzePlaceProfile(makeSummary({ business_status: 'CLOSED_TEMPORARILY' }))
      expect(getCategory(result, 'status').status).toBe('precisa_melhorar')
      expect(result.warnings).toContain('Status: fechado temporariamente.')
    })

    it('CLOSED_PERMANENTLY → ausente + warning', () => {
      const result = analyzePlaceProfile(makeSummary({ business_status: 'CLOSED_PERMANENTLY' }))
      expect(getCategory(result, 'status').status).toBe('ausente')
      expect(result.warnings).toContain('Status: fechado permanentemente.')
    })

    it('unknown status → precisa_melhorar + warning', () => {
      const result = analyzePlaceProfile(makeSummary({ business_status: 'SUSPENDED' }))
      expect(getCategory(result, 'status').status).toBe('precisa_melhorar')
      expect(result.warnings).toContain('Status operacional desconhecido.')
    })
  })

  describe('overallScore weighting', () => {
    it('a perfect profile scores 10', () => {
      expect(analyzePlaceProfile(makeSummary()).overallScore).toBe(10)
    })

    it('fotos and avaliacoes carry 2× weight', () => {
      const result = analyzePlaceProfile(
        makeSummary({ photos_count: 0, rating: null, total_ratings: 0 }),
      )
      // weights: fotos2+avaliacoes2 at 0; 6 others at 10, weight 1 each.
      // weightedSum = 60 ; weightTotal = 10 ; => 6.0
      expect(result.overallScore).toBe(6)
    })

    it('stays within 0–10 (no ×100)', () => {
      const result = analyzePlaceProfile(makeSummary())
      expect(result.overallScore).toBeGreaterThanOrEqual(0)
      expect(result.overallScore).toBeLessThanOrEqual(10)
    })
  })

  describe('edge case: fully empty profile', () => {
    it('scores 0 with all categories ausente/precisa_melhorar and 3 priority actions', () => {
      const result = analyzePlaceProfile(
        makeSummary({
          phone: null,
          website: null,
          rating: null,
          total_ratings: 0,
          has_hours: false,
          hours_text: null,
          photos_count: 0,
          types: [],
          editorial_summary: null,
          business_status: 'CLOSED_PERMANENTLY',
        }),
      )
      expect(result.overallScore).toBe(0)
      expect(result.priorityActions).toHaveLength(3)
      // highest-impact first → fotos (weight 2, deficit 10)
      expect(result.priorityActions[0]).toBe(getCategory(result, 'fotos').recommendation)
    })
  })

  describe('briefing influence', () => {
    it('records the niche in categorias evidence and only affects descricao', () => {
      const briefed = analyzePlaceProfile(makeSummary(), {
        ...EMPTY_BRIEFING,
        industry: 'Alimentação',
      })
      const unbriefed = analyzePlaceProfile(makeSummary())

      expect((briefed.evidence.categorias as { niche: string | null }).niche).toBe('Alimentação')
      expect((unbriefed.evidence.categorias as { niche: string | null }).niche).toBeNull()

      const nonDescStatus = (r: RulesAnalysisResult) =>
        r.categories
          .filter((c) => c.category !== 'descricao')
          .map((c) => `${c.category}:${c.status}`)
      expect(nonDescStatus(briefed)).toEqual(nonDescStatus(unbriefed))
    })

    it('is deterministic for the same summary + briefing', () => {
      const briefing = { ...EMPTY_BRIEFING, industry: 'Alimentação' }
      expect(analyzePlaceProfile(makeSummary(), briefing)).toEqual(
        analyzePlaceProfile(makeSummary(), briefing),
      )
    })
  })
})
