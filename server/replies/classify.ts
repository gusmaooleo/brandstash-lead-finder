export type InboundReplyKind = 'human' | 'automatic' | 'bounce'

export type HeaderInput = Record<string, unknown> | Array<{ name?: unknown; value?: unknown }> | null | undefined

export function normalizeHeaders(input: HeaderInput): Record<string, string> {
  const out: Record<string, string> = {}
  if (Array.isArray(input)) {
    for (const item of input) {
      const name = String(item.name ?? '').trim().toLowerCase()
      if (name) out[name] = String(item.value ?? '').trim()
    }
    return out
  }
  for (const [name, value] of Object.entries(input ?? {})) out[name.toLowerCase()] = String(value ?? '').trim()
  return out
}

export function classifyInboundReply(input: {
  from: string
  subject: string
  headers?: HeaderInput
}): { kind: InboundReplyKind; reason: string | null } {
  const headers = normalizeHeaders(input.headers)
  const from = input.from.toLowerCase()
  const subject = input.subject.trim().toLowerCase()
  if (/mailer-daemon|postmaster|mail delivery subsystem/.test(from)) return { kind: 'bounce', reason: 'sender' }
  if (/delivery status notification|undeliverable|mail delivery failed|returned mail/.test(subject)) {
    return { kind: 'bounce', reason: 'subject' }
  }
  const autoSubmitted = headers['auto-submitted']?.toLowerCase()
  if (autoSubmitted && autoSubmitted !== 'no') return { kind: 'automatic', reason: 'auto-submitted' }
  if (headers['x-autoreply'] || headers['x-autorespond'] || headers['x-auto-response-suppress']) {
    return { kind: 'automatic', reason: 'auto-response-header' }
  }
  if (/^(bulk|junk|list)$/.test(headers.precedence?.toLowerCase() ?? '')) {
    return { kind: 'automatic', reason: 'precedence' }
  }
  if (/automatic reply|auto.?reply|out of office|away from the office|resposta autom[aá]tica|fuera de la oficina|r[eé]ponse automatique|abwesenheitsnotiz/.test(subject)) {
    return { kind: 'automatic', reason: 'subject' }
  }
  return { kind: 'human', reason: null }
}
