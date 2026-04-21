import chokidar from 'chokidar'
import { createLogger } from './logger'

const log = createLogger('watcher')

export type ChangeCallback = (filePath: string) => void

export interface WatcherOptions {
  awaitWriteFinish?: boolean | { stabilityThreshold?: number; pollInterval?: number }
  ignoreInitial?: boolean
}

export function createWatcher(
  workspace: string,
  onChange: ChangeCallback,
  opts: WatcherOptions = {},
): chokidar.FSWatcher {
  const { awaitWriteFinish = { stabilityThreshold: 100, pollInterval: 50 }, ignoreInitial = false } = opts

  const normalizedWorkspace = workspace.replace(/\\/g, '/')
  const pattern = `${normalizedWorkspace}/**/*.ts`

  const watcher = chokidar.watch(pattern, {
    ignored: /(node_modules|\.d\.ts$)/,
    ignoreInitial,
    awaitWriteFinish,
    persistent: true,
  })

  watcher.on('add', (filePath) => {
    log.debug({ filePath }, 'file added')
    onChange(filePath)
  })

  watcher.on('change', (filePath) => {
    log.debug({ filePath }, 'file changed')
    onChange(filePath)
  })

  watcher.on('error', (err) => {
    log.error({ err }, 'watcher error')
  })

  return watcher
}
