import dotenv from 'dotenv'
import path from 'path'

// __dirname = packages/server/src/config — 4 levels up = repo root
// dotenv silently ignores missing files (e.g. in Docker where vars are injected directly)
dotenv.config({ path: path.resolve(__dirname, '../../../../.env') })

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
}
