import { describe, expect, it } from 'vitest'
import { isTransientDbError } from './engine'

describe('isTransientDbError', () => {
  it('matches the sleep/wake server-monitor interruption and friends', () => {
    expect(
      isTransientDbError(new Error('Connection to localhost:27018 interrupted due to server monitor timeout')),
    ).toBe(true)
    expect(isTransientDbError(new Error('connect ECONNREFUSED 127.0.0.1:27018'))).toBe(true)
    expect(isTransientDbError(new Error('Server selection timed out after 30000 ms'))).toBe(true)
  })

  it('does not swallow real discovery errors', () => {
    expect(isTransientDbError(new Error('Places API 403: key invalid'))).toBe(false)
    expect(isTransientDbError(new Error('E11000 duplicate key error'))).toBe(false)
  })
})
