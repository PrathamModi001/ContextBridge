import 'dotenv/config'
import path from 'path'
import { createWatcher } from './watcher'
import { createSocketClient, emitEntityDiff } from './socket'
import { createPipeline } from './pipeline'
import { TSParser } from './parser'
import { createLogger } from './logger'

const log = createLogger('client')

function getArg(args: string[], name: string): string | undefined {
  const idx = args.indexOf(`--${name}`)
  return idx !== -1 ? args[idx + 1] : undefined
}

const args = process.argv.slice(2)
const devId    = getArg(args, 'dev')    ?? process.env.CB_DEV_ID     ?? `dev-${process.pid}`
const workspace = path.resolve(getArg(args, 'workspace') ?? process.env.CB_WORKSPACE ?? process.cwd())
const serverUrl = getArg(args, 'server') ?? process.env.CB_SERVER_URL ?? 'http://localhost:3000'

log.info({ devId, workspace, serverUrl }, 'starting ContextBridge client')

const { socket, close: closeSocket } = createSocketClient(serverUrl, devId)

const tsParser = new TSParser()
const pipeline = createPipeline(tsParser, (_filePath, diffs) => {
  emitEntityDiff(socket, diffs)
})

let watcher: Awaited<ReturnType<typeof createWatcher>> | null = null

// Start watcher only after socket connects — Socket.IO drops emits before connect
socket.on('connect', () => {
  if (watcher) return // already watching (reconnect)
  watcher = createWatcher(workspace, (filePath) => {
    pipeline.processFile(filePath)
  })
  log.info({ workspace }, 'watcher started')
})

async function shutdown() {
  log.info('shutting down')
  if (watcher) await watcher.close()
  closeSocket()
}

process.on('SIGINT',  () => { shutdown().then(() => process.exit(0)).catch(() => process.exit(1)) })
process.on('SIGTERM', () => { shutdown().then(() => process.exit(0)).catch(() => process.exit(1)) })
