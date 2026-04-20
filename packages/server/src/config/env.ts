import 'dotenv/config'

function required(key: string): string {
  const val = process.env[key]
  if (!val) throw new Error(`Missing required env var: ${key}`)
  return val
}

export const env = {
  port: Number(process.env.PORT) || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',
  redisUrl: required('REDIS_URL'),
  postgres: {
    host: required('POSTGRES_HOST'),
    port: Number(process.env.POSTGRES_PORT) || 5432,
    database: required('POSTGRES_DB'),
    user: required('POSTGRES_USER'),
    password: required('POSTGRES_PASSWORD'),
  },
  groqApiKey: process.env.GROQ_API_KEY || '',
}
