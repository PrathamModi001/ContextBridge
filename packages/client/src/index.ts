import 'dotenv/config'
import path from 'path'
import fs from 'fs'
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
const devId     = getArg(args, 'dev')    ?? process.env.CB_DEV_ID     ?? `dev-${process.pid}`
const serverUrl = getArg(args, 'server') ?? process.env.CB_SERVER_URL ?? 'http://localhost:3000'

// Resolve workspace relative to INIT_CWD (npm invocation dir = monorepo root),
// not process.cwd() which npm changes to the package dir when using -w.
const cwdBase   = process.env.INIT_CWD ?? process.cwd()
const workspace = path.resolve(cwdBase, getArg(args, 'workspace') ?? process.env.CB_WORKSPACE ?? '.')

log.info({ devId, workspace, serverUrl }, 'starting ContextBridge client')

const { socket, close: closeSocket } = createSocketClient(serverUrl, devId)

const tsParser = new TSParser()
const pipeline = createPipeline(tsParser, (_filePath, diffs) => {
  emitEntityDiff(socket, diffs)
})

let watcher: Awaited<ReturnType<typeof createWatcher>> | null = null

function rescanWorkspace() {
  if (!fs.existsSync(workspace)) return
  const files = fs.readdirSync(workspace).filter(f => f.endsWith('.ts'))
  for (const f of files) {
    const fp = path.join(workspace, f)
    pipeline.clearFile(fp)       // reset cached state so diff treats all entities as new
    pipeline.processFile(fp)
  }
  log.info({ workspace, count: files.length }, 'workspace rescanned')
}

// Start watcher only after socket connects — Socket.IO drops emits before connect
socket.on('connect', () => {
  if (watcher) return // already watching (reconnect)
  watcher = createWatcher(workspace, (filePath) => {
    pipeline.processFile(filePath)
  })
  log.info({ workspace }, 'watcher started')
})

// Re-emit all entities after server flush (Redis cleared, chokidar won't re-fire)
socket.on('workspace:rescan', () => {
  log.info('workspace:rescan received — re-emitting all entities')
  rescanWorkspace()
})

async function shutdown() {
  log.info('shutting down')
  if (watcher) await watcher.close()
  closeSocket()
}

process.on('SIGINT',  () => { shutdown().then(() => process.exit(0)).catch(() => process.exit(1)) })
process.on('SIGTERM', () => { shutdown().then(() => process.exit(0)).catch(() => process.exit(1)) })
