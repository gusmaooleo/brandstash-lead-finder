/**
 * Guard: MongoDB is strictly server-side. Nothing under web/ (the browser
 * bundle source) may reference Mongo connection variables or URIs, and no
 * VITE_-prefixed variable (the only kind Vite exposes to the client) may
 * carry Mongo configuration.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const WEB_ROOT = join(__dirname, '..', '..', 'web')

function walk(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...walk(full))
    else if (/\.(ts|tsx|css|html|js)$/.test(entry)) out.push(full)
  }
  return out
}

describe('browser bundle never sees Mongo', () => {
  const files = walk(WEB_ROOT)

  it('web/ sources are non-empty and scanned', () => {
    expect(files.length).toBeGreaterThan(5)
  })

  it('no Mongo variable, URI or driver import in any web/ source', () => {
    for (const file of files) {
      const content = readFileSync(file, 'utf8')
      expect(content, file).not.toMatch(/MONGODB_URI|LANDING_MONGODB|mongodb(\+srv)?:\/\/|from 'mongoose'|from "mongoose"/)
    }
  })

  it('no VITE_-exposed variable carries Mongo config', () => {
    const envFiles = ['.env.example']
    for (const name of envFiles) {
      const content = readFileSync(join(__dirname, '..', '..', name), 'utf8')
      for (const line of content.split('\n')) {
        if (line.trim().startsWith('VITE_')) {
          expect(line, name).not.toMatch(/MONGO/i)
        }
      }
    }
  })
})
