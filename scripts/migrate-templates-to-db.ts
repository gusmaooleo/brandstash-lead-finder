/**
 * ONE-SHOT migration: the coded email packs → the database.
 *
 * Every template must live in MongoDB, so this walks the packs that are still
 * in the code and materializes each one into a template document: same HTML,
 * same words, with the per-lead values replaced by {{tokens}} the renderer
 * already understands. It is the last thing that reads notes.ts /
 * notes-agency.ts — both are deleted right after it runs, and so is this file.
 *
 * Fidelity comes from calling the REAL renderer with a token context instead
 * of re-typing the copy: whatever the pack produces today is what lands in the
 * database, shell, signature, compliance footer and all.
 *
 *   pnpm exec tsx scripts/migrate-templates-to-db.ts --dry-run   # inspect
 *   pnpm exec tsx scripts/migrate-templates-to-db.ts             # write
 */

import { writeFileSync } from 'node:fs'
import mongoose from 'mongoose'
import { config } from '../server/config'
import type { EmailLanguage } from '../shared/types'
import { EmailTemplate } from '../server/email/template-models'
import {
  NOTE_PACKS,
  NOTE_VARIANT_COUNT,
  renderNoteEmail,
  type NoteCtx,
  type NotePack,
  type Template,
} from '../server/email/notes'
import { AGENCY_NOTE_PACKS } from '../server/email/notes-agency'

const DRY_RUN = process.argv.includes('--dry-run')
const LANGUAGES = Object.keys(NOTE_PACKS) as EmailLanguage[]

/**
 * A number whose every rendering is a token: `${n}` and `n.toFixed(1)` both
 * come out as the placeholder, so numeric copy migrates like textual copy.
 */
function numberToken(token: string): number {
  return { toString: () => token, toFixed: () => token, valueOf: () => token } as unknown as number
}

const TOKEN_CTX: NoteCtx = {
  name: '{{business_name}}',
  city: '{{city}}',
  rating: numberToken('{{rating}}'),
  reviews: numberToken('{{reviews}}'),
  score: numberToken('{{score}}'),
  f1: '{{finding_1}}',
  f2: '{{finding_2}}',
  sender: '{{sender_first_name}}',
}

/**
 * Freezes a pack's templates onto the token context. renderNoteEmail still
 * builds its own context (from findings, rotation, the lead's data) — these
 * wrappers ignore it, so the copy comes out parameterized instead of filled
 * in for one imaginary lead.
 */
const onTokens = (t: Template): Template => ({
  subject: () => t.subject(TOKEN_CTX),
  paragraphs: () => t.paragraphs(TOKEN_CTX),
  ...(t.ps ? { ps: () => t.ps!(TOKEN_CTX) } : {}),
})

const tokenPack = (pack: NotePack): NotePack => ({
  ...pack,
  variants: [onTokens(pack.variants[0]), onTokens(pack.variants[1]), onTokens(pack.variants[2])],
  followups: [onTokens(pack.followups[0]), onTokens(pack.followups[1])],
})

/** The renderer's non-copy inputs, all of them tokens. */
const RENDER_INPUT = {
  placeId: 'migration',
  name: '{{business_name}}',
  cityLabel: '{{city}}',
  rating: numberToken('{{rating}}'),
  reviewCount: numberToken('{{reviews}}'),
  score: numberToken('{{score}}'),
  summary: { photos_count: 0, has_hours: false, editorial_summary: null, total_ratings: 0 },
  sender: { name: '{{sender_name}}', email: '{{sender_email}}' },
  unsubscribeUrl: '{{unsubscribe_url}}',
  brandName: '{{brand_name}}',
  landingUrl: '{{landing_url}}',
}

type Variant = { subject: string; html: string; text: string | null; band: null }
type Message = { followup: number; variants: Variant[] }

function messagesFor(pack: NotePack, language: EmailLanguage): Message[] {
  const wrapped = tokenPack(pack)
  const render = (variant: number, followupNumber: 0 | 1 | 2): Variant => {
    const out = renderNoteEmail({ ...RENDER_INPUT, language, pack: wrapped, variant, followupNumber })
    return { subject: out.subject, html: out.html, text: out.text, band: null }
  }
  return [
    // The initial send is the one with real angles — three of them.
    { followup: 0, variants: Array.from({ length: NOTE_VARIANT_COUNT }, (_, v) => render(v, 0)) },
    { followup: 1, variants: [render(0, 1)] },
    { followup: 2, variants: [render(0, 2)] },
  ]
}

/**
 * The findings phrases, verbatim from the pack. The RULE that picks one stays
 * in code; these are its words, and words belong in the database.
 */
function findingsFor(pack: NotePack): Record<string, string> {
  const count = numberToken('{{count}}')
  return {
    no_photos: pack.findings.noPhotos,
    few_photos: pack.findings.fewPhotos(count),
    no_reviews: pack.findings.noReviews,
    few_reviews: pack.findings.fewReviews(count),
    no_hours: pack.findings.noHours,
    no_description: pack.findings.noDescription,
    clean: pack.findings.clean,
  }
}

const LANGUAGE_LABEL: Record<string, string> = {
  pt: 'PT', en: 'EN', es: 'ES', fr: 'FR', de: 'DE', it: 'IT',
  'zh-TW': 'ZH-TW', 'zh-HK': 'ZH-HK', ja: 'JA', ko: 'KO',
}

async function main(): Promise<void> {
  await mongoose.connect(config.mongodbUri)

  // The rows that exist today carry the owner's targeting (which categories
  // each pack serves, its priority, whether it is on). That is configuration,
  // not copy — it survives the migration.
  const existing = await EmailTemplate.collection
    .find({ kind: 'builtin' }, { projection: { name: 1, builtin_pack: 1, categories: 1, priority: 1, active: 1, audience: 1 } })
    .toArray()
  const byPack = new Map(existing.map((row) => [String(row.builtin_pack), row]))
  console.log(`[migrate] found ${existing.length} builtin row(s) to carry settings from`)

  const docs: Array<Record<string, unknown>> = []
  for (const language of LANGUAGES) {
    for (const [packKey, packs, baseName, audience] of [
      ['business_note', NOTE_PACKS, 'Business owners — personal note', 'business'],
      ['agency_note', AGENCY_NOTE_PACKS, 'Marketing agencies — multi-client panel', 'agency'],
    ] as const) {
      const pack = packs[language]
      if (!pack) continue
      const source = byPack.get(packKey)
      docs.push({
        name: `${baseName} · ${LANGUAGE_LABEL[language] ?? language.toUpperCase()}`,
        audience: (source?.audience as string) ?? audience,
        categories: (source?.categories as string[]) ?? [],
        language,
        active: source?.active !== false,
        priority: (source?.priority as number) ?? 100,
        messages: messagesFor(pack, language),
        findings: findingsFor(pack),
        low_score_variants: false,
        assets: [],
        notes: `Migrated from the coded ${packKey} pack.`,
      })
    }
  }

  console.log(`[migrate] materialized ${docs.length} templates across ${LANGUAGES.length} languages`)
  const sample = docs.find((d) => (d.name as string).endsWith('PT'))!
  const firstVariant = (sample.messages as Message[])[0].variants[0]
  console.log(`[migrate] sample subject: ${firstVariant.subject}`)
  const tokens = [...new Set(JSON.stringify(docs).match(/\{\{[a-z0-9_]+\}\}/g) ?? [])].sort()
  console.log(`[migrate] tokens used: ${tokens.join(' ')}`)

  if (DRY_RUN) {
    const out = '/tmp/migrate-sample.html'
    writeFileSync(out, firstVariant.html)
    console.log(`[migrate] DRY RUN — nothing written. Sample HTML: ${out}`)
    await mongoose.disconnect()
    return
  }

  for (const doc of docs) {
    await EmailTemplate.collection.updateOne(
      { name: doc.name, language: doc.language },
      { $set: doc, $setOnInsert: { created_at: new Date() } },
      { upsert: true },
    )
  }
  const removed = await EmailTemplate.collection.deleteMany({ kind: 'builtin' })
  console.log(`[migrate] wrote ${docs.length} templates, removed ${removed.deletedCount} builtin shell(s)`)
  await mongoose.disconnect()
}

main().catch((err) => {
  console.error('[migrate] failed:', err)
  process.exit(1)
})
