import { fetchContext, validateUsage } from '../../src/context'

const mockFetch = jest.fn()
global.fetch = mockFetch as unknown as typeof fetch

describe('fetchContext', () => {
  it('fetches markdown snapshot from server', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve('# ContextBridge Snapshot\n## Entities (1)'),
    })
    const result = await fetchContext('http://localhost:3000')
    expect(result).toContain('ContextBridge Snapshot')
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:3000/v1/context/snapshot?format=markdown',
    )
  })

  it('throws on non-OK response', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 503, statusText: 'Service Unavailable' })
    await expect(fetchContext('http://localhost:3000')).rejects.toThrow('503')
  })

  it('propagates network errors', async () => {
    mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'))
    await expect(fetchContext('http://localhost:3000')).rejects.toThrow('ECONNREFUSED')
  })
})

describe('validateUsage', () => {
  it('posts code and returns conflict list', async () => {
    const mockPayload = { conflicts: [] }
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockPayload),
    })
    const result = await validateUsage('http://localhost:3000', 'const x = 1')
    expect(result.conflicts).toHaveLength(0)
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:3000/v1/context/validate',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: 'const x = 1' }),
      }),
    )
  })

  it('returns conflicts when code is stale', async () => {
    const conflict = {
      entity: 'validateUser',
      yourSignature: 'validateUser(userId)',
      liveSignature: 'validateUser(id: string, permissions: string[])',
      severity: 'warning',
      devId: 'devA',
      correctedCall: 'validateUser(id, permissions)',
    }
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ conflicts: [conflict] }),
    })
    const result = await validateUsage('http://localhost:3000', 'validateUser(userId)')
    expect(result.conflicts).toHaveLength(1)
    expect(result.conflicts[0].entity).toBe('validateUser')
    expect(result.conflicts[0].severity).toBe('warning')
    expect(result.conflicts[0].correctedCall).toBeDefined()
  })

  it('throws on non-OK response', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 400, statusText: 'Bad Request' })
    await expect(validateUsage('http://localhost:3000', 'code')).rejects.toThrow('400')
  })
})
