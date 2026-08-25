import { createHash } from 'node:crypto'
import type { RenderableVariant } from '../email/template-render'

export type VariantIdentityInput = {
  templateKey: string
  language: string
  followup: number
  variant: RenderableVariant
}

export function variantFingerprint(input: VariantIdentityInput): string {
  const source = JSON.stringify({
    template: input.templateKey,
    language: input.language,
    followup: input.followup,
    subject: input.variant.subject,
    html: input.variant.html,
    text: input.variant.text ?? null,
    preheader: input.variant.preheader ?? '',
    band: input.variant.band ?? null,
    needs_rating: Boolean(input.variant.needs_rating),
  })
  return createHash('sha256').update(source, 'utf8').digest('hex')
}
