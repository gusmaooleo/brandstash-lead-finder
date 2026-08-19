/**
 * Public unsubscribe endpoint (linked from every email + List-Unsubscribe
 * header). GET renders a localized confirmation page; POST handles RFC 8058
 * one-click. Both add the recipient to the suppression list — idempotent.
 */

import { Router } from 'express'
import { Approved, Suppression } from '../leads/models'
import type { EmailLanguage } from '../../shared/types'

export const unsubscribe = Router()

const COPY: Record<EmailLanguage, { title: string; body: string }> = {
  en: { title: 'You’re unsubscribed', body: 'You will not receive any further messages from us.' },
  pt: { title: 'Inscrição cancelada', body: 'Você não receberá mais nenhuma mensagem nossa.' },
  es: { title: 'Suscripción cancelada', body: 'No recibirás más mensajes nuestros.' },
  fr: { title: 'Désinscription confirmée', body: 'Vous ne recevrez plus aucun message de notre part.' },
  de: { title: 'Abmeldung bestätigt', body: 'Sie erhalten keine weiteren Nachrichten von uns.' },
  'zh-TW': { title: '已取消訂閱', body: '您將不會再收到我們的任何郵件。' },
  'zh-HK': { title: '已取消訂閱', body: '您唔會再收到我哋嘅任何電郵。' },
  ja: { title: '配信を停止しました', body: '今後、当方からのメールが届くことはありません。' },
  ko: { title: '수신 거부 완료', body: '앞으로 저희 메일을 받지 않으시게 됩니다.' },
}

async function applyUnsubscribe(token: string): Promise<EmailLanguage | null> {
  const lead = await Approved.findOne({ 'delivery.unsubscribe_token': token })
  if (!lead?.contact.selected_email) return null
  const email = lead.contact.selected_email.toLowerCase()
  await Suppression.updateOne(
    { email },
    { $setOnInsert: { email, reason: 'unsubscribed' } },
    { upsert: true },
  )
  lead.audit_trail.push({ at: new Date(), event: 'unsubscribed' })
  await lead.save()
  return (lead.language as EmailLanguage) ?? 'en'
}

function page(lang: EmailLanguage): string {
  const copy = COPY[lang] ?? COPY.en
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${copy.title}</title></head>
<body style="margin:0;background:#f1f0ec;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<div style="max-width:420px;margin:80px auto;background:#fff;border:1px solid #e2e1dc;border-radius:16px;padding:36px;text-align:center;">
<div style="font-size:20px;font-weight:700;color:#0b0b0c;">${copy.title}</div>
<div style="font-size:14px;color:#57575b;margin-top:10px;line-height:1.6;">${copy.body}</div>
</div></body></html>`
}

unsubscribe.get('/unsubscribe', async (req, res) => {
  const token = String(req.query.t ?? '')
  const lang = token ? await applyUnsubscribe(token) : null
  res.status(lang ? 200 : 404).send(page(lang ?? 'en'))
})

unsubscribe.post('/unsubscribe', async (req, res) => {
  const token = String(req.query.t ?? '')
  const lang = token ? await applyUnsubscribe(token) : null
  res.status(lang ? 200 : 404).json({ ok: Boolean(lang) })
})
