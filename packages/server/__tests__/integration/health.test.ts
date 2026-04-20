import request from 'supertest'
import app from '../../src/app'

describe('GET /v1/health', () => {
  it('returns 200 with status ok', async () => {
    const res = await request(app).get('/v1/health')
    expect(res.status).toBe(200)
    expect(res.body.status).toBe('ok')
  })

  it('returns ts as a number', async () => {
    const res = await request(app).get('/v1/health')
    expect(typeof res.body.ts).toBe('number')
  })

  it('ts is within a recent time window', async () => {
    const before = Date.now()
    const res = await request(app).get('/v1/health')
    const after = Date.now()
    expect(res.body.ts).toBeGreaterThanOrEqual(before)
    expect(res.body.ts).toBeLessThanOrEqual(after)
  })

  it('returns application/json content-type', async () => {
    const res = await request(app).get('/v1/health')
    expect(res.headers['content-type']).toMatch(/application\/json/)
  })

  it('includes security headers from helmet', async () => {
    const res = await request(app).get('/v1/health')
    expect(res.headers['x-content-type-options']).toBe('nosniff')
    expect(res.headers['x-frame-options']).toBeDefined()
  })

  it('accepts GET only — POST returns 404', async () => {
    const res = await request(app).post('/v1/health')
    expect(res.status).toBe(404)
  })

  it('unknown route under /v1 returns 404', async () => {
    const res = await request(app).get('/v1/nonexistent')
    expect(res.status).toBe(404)
  })

  it('route without /v1 prefix returns 404', async () => {
    const res = await request(app).get('/health')
    expect(res.status).toBe(404)
  })
})

describe('global error handler integration', () => {
  it('returns JSON error body for 404 routes', async () => {
    const res = await request(app).get('/v1/does-not-exist')
    expect(res.status).toBe(404)
    expect(res.headers['content-type']).toMatch(/application\/json/)
  })

  it('malformed JSON body returns 400', async () => {
    const res = await request(app)
      .post('/v1/health')
      .set('Content-Type', 'application/json')
      .send('{ bad json }')
    expect(res.status).toBe(400)
  })
})
