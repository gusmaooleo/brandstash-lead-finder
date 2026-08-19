/**
 * Recipient ELECTION — when a site exposes several public addresses, one of
 * them is elected as the default recipient so "Approve & send" is available
 * straight from the list. The election never invents an address: it only
 * ranks what the inspection found, and the owner can always override it in
 * the lead page (the dropdown keeps every candidate).
 *
 * Ranking, best first:
 *  1. domain class, the order the approval UI lists them in — own domain →
 *     freemail → third party. Freemail is a first-class contact (a gmail on
 *     the shop's own site IS the shop); a third-party address is a last
 *     resort and the UI badges it "may be third-party".
 *  2. within a domain class, the desk that actually reads a proposal: a
 *     general inbox (contact@, info@, post@) → a commercial one (sales@,
 *     comercial@) → any other generic → a named person or branch
 *     (anna@, ensjo@) → a task queue (support@, bookings@, billing@), which
 *     files a pitch as a customer ticket and therefore ranks below a human
 *     at the same domain.
 *  3. a domain with proven MX beats one DNS never confirmed.
 *  4. discovery order (already priority-sorted) — deterministic ties.
 *
 * Never electable, at any rank: a domain with no MX (guaranteed bounce), an
 * address the caller blocks (suppression list / dead registry — electing one
 * would offer a button whose send is refused), a public authority quoted on
 * someone else's site (regulators, agencies), and anything the extraction
 * filters reject (no-reply, DPO, web-vendor domains…) so legacy rows can't
 * resurrect an address today's rules would never keep. When nothing survives,
 * the election returns null and the lead keeps demanding a manual choice.
 */

import type { ContactEmail, EmailDomainKind } from '../../shared/types'
import { classifyEmailDomain, isGenericPrefix, isPlausibleBusinessEmail } from './email-extract'

/** The front desk / owner's inbox — a pitch read by whoever decides. */
const GENERAL_ROLES = [
  'contact', 'contato', 'contacto', 'contatto', 'contatti', 'contactez', 'contactanos', 'kontakt',
  'info', 'infos', 'informacion', 'informacoes', 'hello', 'hallo', 'hi', 'ola', 'hola', 'bonjour',
  'ciao', 'mail', 'email', 'geral', 'general', 'office', 'buero', 'accueil', 'welcome', 'team',
  'equipe', 'enquiries', 'inquiries', 'inquiry', 'anfrage', 'anfragen', 'faleconosco', 'atendimento',
  // no/dk/se "post@", fi "toimisto@", de "empfang@/zentrale@", nl "receptie@"
  'post', 'firmapost', 'kansli', 'toimisto', 'empfang', 'zentrale', 'reception', 'receptie',
  'resepsjon', 'frontdesk',
]
/** Sells for a living — the second-best desk for a commercial proposal. */
const COMMERCIAL_ROLES = [
  'sales', 'vendas', 'ventas', 'vendite', 'comercial', 'commercial', 'commande', 'marketing',
  'orcamento', 'orcamentos', 'presupuesto', 'devis', 'verkoop', 'verkauf', 'myynti', 'forsaljning',
]
/** Task queues: they answer customers, not proposals. Last among generics. */
const OPERATIONAL_ROLES = [
  'support', 'suporte', 'soporte', 'service', 'services', 'servicio', 'sac', 'help', 'ajuda',
  'customer', 'cliente', 'clientes',
  'booking', 'bookings', 'buchung', 'buchungen', 'reservation', 'reservations', 'reserva', 'reservas',
  'reservierung', 'prenotazioni', 'termin', 'agendamento', 'billing', 'invoice', 'faturamento',
  'financeiro', 'contabilidade', 'admin', 'administracao', 'amministrazione', 'segreteria',
  'compras', 'shop', 'store', 'loja', 'pedidos', 'orders', 'order', 'bokning', 'afspraak',
  'kundeservice', 'kundtjanst', 'klantenservice', 'asiakaspalvelu',
]

/**
 * A public authority (gov.au, gouv.fr, gob.mx…). Fine when it IS the lead —
 * a museum or a city library is a legitimate business on its own domain —
 * but an authority address on someone ELSE's site is a regulator or an
 * agency the page merely cites, never the recipient of our pitch.
 */
function isPublicAuthorityDomain(address: string): boolean {
  const domain = address.split('@')[1]?.toLowerCase() ?? ''
  return /(^|\.)(gov|gouv|gob|govt|mil)(\.[a-z]{2,3})?$/.test(domain)
}

function matchesRole(local: string, roles: readonly string[]): boolean {
  const normalized = local.replace(/[^a-z]/g, '')
  return roles.some(
    (r) => local === r || normalized === r || (r.length >= 4 && (local.startsWith(r) || normalized.startsWith(r))),
  )
}

/**
 * Who is behind the address: 0 general desk · 1 commercial desk · 2 unlisted
 * generic inbox · 3 a named person/branch at the business · 4 a task queue.
 * Tiers 0–2 are the inboxes a proposal actually reaches, so they lift the
 * address into the "generic" group below; a support/booking/billing queue
 * does not — it files a pitch as a customer ticket, and a real person at the
 * same domain beats it.
 */
function roleTier(address: string, generic: boolean): number {
  if (!generic) return 3
  const local = address.split('@')[0]?.toLowerCase() ?? ''
  if (matchesRole(local, GENERAL_ROLES)) return 0
  if (matchesRole(local, COMMERCIAL_ROLES)) return 1
  if (matchesRole(local, OPERATIONAL_ROLES)) return 4
  return 2
}

/** Same order the approval list shows — see the module header. */
function classRank(kind: EmailDomainKind, reachesDecisionMaker: boolean): number {
  if (kind === 'own') return reachesDecisionMaker ? 0 : 2
  if (kind === 'freemail') return reachesDecisionMaker ? 1 : 3
  return reachesDecisionMaker ? 4 : 5
}

export type ElectionOptions = {
  /** Suppressed / dead addresses: real inboxes we are barred from mailing. */
  blocked?: ReadonlySet<string>
  /** Classifies legacy rows whose `kind` was never stored. */
  ownDomain?: string | null
}

/**
 * The best recipient among the discovered addresses, or null when none can
 * be mailed. Pure — no DB, no DNS: `blocked` and the stored `mx` carry all
 * the evidence.
 */
export function electRecipient(
  emails: readonly ContactEmail[],
  { blocked, ownDomain = null }: ElectionOptions = {},
): string | null {
  let bestKey: number[] | null = null
  let bestAddress: string | null = null

  emails.forEach((email, index) => {
    const address = email.address?.trim().toLowerCase()
    if (!address) return
    if (email.mx === 'no_mx') return
    if (blocked?.has(address)) return
    if (!isPlausibleBusinessEmail(address)) return

    const kind = email.kind ?? classifyEmailDomain(address, ownDomain)
    if (kind === 'third_party' && isPublicAuthorityDomain(address)) return
    // The stored flag is a cache of a rule that keeps improving (new
    // languages' inbox names); re-checking can only promote an address to
    // "generic", never demote a legacy row.
    const generic = email.generic || isGenericPrefix(address)
    const tier = roleTier(address, generic)
    const key = [classRank(kind, tier <= 2), tier, email.mx === 'ok' ? 0 : 1, index]
    if (!bestKey || isBetter(key, bestKey)) {
      bestKey = key
      bestAddress = address
    }
  })

  return bestAddress
}

/** Lexicographic compare of the ranking keys — lower wins. */
function isBetter(key: readonly number[], best: readonly number[]): boolean {
  for (let i = 0; i < key.length; i++) {
    if (key[i] !== best[i]) return key[i] < best[i]
  }
  return false
}
