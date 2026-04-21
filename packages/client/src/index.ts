import 'dotenv/config'
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
const devId = getArg(args, 'dev') ?? `dev-${process.pid}`
const workspace = getArg(args, 'workspace') ?? process.cwd()
const serverUrl = getArg(args, 'server') ?? 'http://localhost:3000'

log.info({ devId, workspace, serverUrl }, 'starting ContextBridge client')

const { socket, close: closeSocket } = createSocketClient(serverUrl, devId)

const tsParser = new TSParser()
const pipeline = createPipeline(tsParser, (_filePath, diffs) => {
  emitEntityDiff(socket, diffs)
})

const watcher = createWatcher(workspace, (filePath) => {
  pipeline.processFile(filePath)
})

async function shutdown() {
  log.info('shutting down')
  await watcher.close()
  closeSocket()
}

process.on('SIGINT', () => { shutdown().then(() => process.exit(0)) })
process.on('SIGTERM', () => { shutdown().then(() => process.exit(0)) })
