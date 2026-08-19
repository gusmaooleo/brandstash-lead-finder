/**
 * Anthropic client — the ONE place the app talks to Claude. Used by the
 * Settings screen to list the models the owner's key can use, and by the
 * email generator to write templates.
 *
 * Plain fetch against the documented REST contract (no SDK dependency):
 *   GET  /v1/models   → { data: [{ id, display_name, created_at, … }] }
 *   POST /v1/messages → { content: [{ type: 'text', text }], usage }
 * Both authenticate with `x-api-key` + `anthropic-version`. The key comes
 * from the encrypted settings document and is never logged or returned.
 */

import { settings } from './settings'

const API_BASE = 'https://api.anthropic.com'
const API_VERSION = '2023-06-01'
const LIST_TIMEOUT_MS = 15_000
const GENERATE_TIMEOUT_MS = 180_000

export class AnthropicError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

export type AnthropicModel = {
  id: string
  display_name: string
  created_at: string | null
}

function headers(apiKey: string): Record<string, string> {
  return {
    'x-api-key': apiKey,
    'anthropic-version': API_VERSION,
    'content-type': 'application/json',
  }
}

/** Never let a provider error carry the key back to the browser. */
function scrub(text: string, apiKey: string): string {
  return apiKey ? text.split(apiKey).join('[api-key]') : text
}

async function readError(res: Response, apiKey: string): Promise<never> {
  const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null
  const detail = body?.error?.message ?? `${res.status} ${res.statusText}`
  throw new AnthropicError(res.status, `Anthropic API ${res.status}: ${scrub(detail, apiKey)}`)
}

/**
 * Models the given key may use, newest first. `apiKey` overrides the stored
 * one so the Settings screen can validate a key the owner just pasted but
 * hasn't saved yet.
 */
export async function listModels(apiKey?: string): Promise<AnthropicModel[]> {
  const key = (apiKey ?? settings().ai.anthropicKey).trim()
  if (!key) throw new AnthropicError(400, 'No Anthropic API key configured')
  const res = await fetch(`${API_BASE}/v1/models?limit=100`, {
    headers: headers(key),
    signal: AbortSignal.timeout(LIST_TIMEOUT_MS),
  })
  if (!res.ok) await readError(res, key)
  const body = (await res.json()) as { data?: Array<{ id: string; display_name?: string; created_at?: string }> }
  return (body.data ?? []).map((m) => ({
    id: m.id,
    display_name: m.display_name ?? m.id,
    created_at: m.created_at ?? null,
  }))
}

export type GenerateInput = {
  system: string
  prompt: string
  /** Defaults to the model chosen in Settings. */
  model?: string
  maxTokens?: number
}

/** One completion — returns the concatenated text blocks. */
export async function generateText({ system, prompt, model, maxTokens = 8000 }: GenerateInput): Promise<{
  text: string
  model: string
  usage: { input_tokens: number; output_tokens: number } | null
}> {
  const key = settings().ai.anthropicKey.trim()
  if (!key) throw new AnthropicError(400, 'No Anthropic API key configured — add it in Settings.')
  const chosen = (model ?? settings().ai.model).trim()
  if (!chosen) throw new AnthropicError(400, 'No Anthropic model chosen — pick one in Settings.')

  const res = await fetch(`${API_BASE}/v1/messages`, {
    method: 'POST',
    headers: headers(key),
    body: JSON.stringify({
      model: chosen,
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: prompt }],
    }),
    signal: AbortSignal.timeout(GENERATE_TIMEOUT_MS),
  })
  if (!res.ok) await readError(res, key)
  const body = (await res.json()) as {
    content?: Array<{ type: string; text?: string }>
    usage?: { input_tokens: number; output_tokens: number }
  }
  const text = (body.content ?? [])
    .filter((block) => block.type === 'text')
    .map((block) => block.text ?? '')
    .join('')
    .trim()
  if (!text) throw new AnthropicError(502, 'Anthropic returned an empty response')
  return { text, model: chosen, usage: body.usage ?? null }
}
