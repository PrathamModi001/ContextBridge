const DEFAULTS: Record<string, string> = {
  REDIS_URL: 'redis://localhost:6379',
  POSTGRES_HOST: 'localhost',
  POSTGRES_DB: 'contextbridge',
  POSTGRES_USER: 'postgres',
  POSTGRES_PASSWORD: 'postgres',
}

describe('env config', () => {
  beforeEach(() => {
    Object.entries(DEFAULTS).forEach(([k, v]) => (process.env[k] = v))
    jest.resetModules()
  })

  afterEach(() => {
    Object.keys(DEFAULTS).forEach((k) => delete process.env[k])
    delete process.env.PORT
    delete process.env.NODE_ENV
    delete process.env.GROQ_API_KEY
    delete process.env.POSTGRES_PORT
    jest.resetModules()
  })

  // --- Required vars throw when missing ---
  describe('required var validation', () => {
    it.each(Object.keys(DEFAULTS))('throws if %s is missing', (varName) => {
      delete process.env[varName]
      expect(() => require('../../src/config/env')).toThrow(
        `Missing required env var: ${varName}`,
      )
    })

    it('throws on the first missing var encountered, not all at once', () => {
      delete process.env.REDIS_URL
      delete process.env.POSTGRES_HOST
      expect(() => require('../../src/config/env')).toThrow('Missing required env var: REDIS_URL')
    })

    it('throws even if var is empty string', () => {
      process.env.REDIS_URL = ''
      expect(() => require('../../src/config/env')).toThrow('Missing required env var: REDIS_URL')
    })

    it('does not throw when all required vars are set', () => {
      expect(() => require('../../src/config/env')).not.toThrow()
    })
  })

  // --- PORT parsing ---
  describe('PORT', () => {
    it('defaults to 3000 when PORT not set', () => {
      delete process.env.PORT
      const { env } = require('../../src/config/env')
      expect(env.port).toBe(3000)
    })

    it('uses PORT env var when set', () => {
      process.env.PORT = '4000'
      const { env } = require('../../src/config/env')
      expect(env.port).toBe(4000)
    })

    it('port is a number, not a string', () => {
      process.env.PORT = '8080'
      const { env } = require('../../src/config/env')
      expect(typeof env.port).toBe('number')
    })

    it('defaults to 3000 when PORT is non-numeric', () => {
      process.env.PORT = 'not-a-number'
      const { env } = require('../../src/config/env')
      expect(env.port).toBe(3000)
    })
  })

  // --- NODE_ENV ---
  describe('nodeEnv', () => {
    it('defaults to development when NODE_ENV not set', () => {
      delete process.env.NODE_ENV
      const { env } = require('../../src/config/env')
      expect(env.nodeEnv).toBe('development')
    })

    it('uses NODE_ENV when set', () => {
      process.env.NODE_ENV = 'production'
      const { env } = require('../../src/config/env')
      expect(env.nodeEnv).toBe('production')
    })
  })

  // --- GROQ_API_KEY (optional) ---
  describe('groqApiKey', () => {
    it('defaults to empty string when not set', () => {
      delete process.env.GROQ_API_KEY
      const { env } = require('../../src/config/env')
      expect(env.groqApiKey).toBe('')
    })

    it('does not throw when GROQ_API_KEY is missing', () => {
      delete process.env.GROQ_API_KEY
      expect(() => require('../../src/config/env')).not.toThrow()
    })

    it('uses GROQ_API_KEY when set', () => {
      process.env.GROQ_API_KEY = 'gsk_test_key'
      const { env } = require('../../src/config/env')
      expect(env.groqApiKey).toBe('gsk_test_key')
    })
  })

  // --- Postgres config ---
  describe('postgres config', () => {
    it('reads all postgres vars', () => {
      process.env.POSTGRES_HOST = 'db.example.com'
      process.env.POSTGRES_DB = 'mydb'
      process.env.POSTGRES_USER = 'admin'
      process.env.POSTGRES_PASSWORD = 'secret'
      const { env } = require('../../src/config/env')
      expect(env.postgres.host).toBe('db.example.com')
      expect(env.postgres.database).toBe('mydb')
      expect(env.postgres.user).toBe('admin')
      expect(env.postgres.password).toBe('secret')
    })

    it('defaults POSTGRES_PORT to 5432 when not set', () => {
      delete process.env.POSTGRES_PORT
      const { env } = require('../../src/config/env')
      expect(env.postgres.port).toBe(5432)
    })

    it('uses POSTGRES_PORT env var when set', () => {
      process.env.POSTGRES_PORT = '5433'
      const { env } = require('../../src/config/env')
      expect(env.postgres.port).toBe(5433)
    })

    it('postgres.port is a number', () => {
      const { env } = require('../../src/config/env')
      expect(typeof env.postgres.port).toBe('number')
    })
  })
})
