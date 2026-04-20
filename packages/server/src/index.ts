import 'dotenv/config'
import { createServer } from 'http'
import app from './app'
import { connectRedis } from './config/redis'
import { connectPostgres } from './config/postgres'
import { initSocket } from './socket'
import { env } from './config/env'
import logger from './logger/logger'

process.on('unhandledRejection', (reason) => {
  logger.error({ reason }, 'Unhandled rejection')
})

process.on('uncaughtException', (err) => {
  logger.error({ err }, 'Uncaught exception')
  process.exit(1)
})

export async function startServer() {
  await connectRedis()
  await connectPostgres()

  const httpServer = createServer(app)
  initSocket(httpServer)

  await new Promise<void>((resolve) => {
    httpServer.listen(env.port, () => {
      logger.info(`Server on :${env.port}`)
      resolve()
    })
  })

  return httpServer
}

if (require.main === module) {
  startServer().catch((err) => {
    logger.error({ err }, 'Failed to start server')
    process.exit(1)
  })
}
