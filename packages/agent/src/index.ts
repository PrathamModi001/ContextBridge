import path from 'path'
import dotenv from 'dotenv'
import { runAgent } from './agent'
import type { AgentConfig, AgentMode } from './types'

dotenv.config({ path: path.resolve(process.cwd(), '.env') })

function getArg(flag: string): string | undefined {
  const arg = process.argv.slice(2).find(a => a.startsWith(`--${flag}=`))
  return arg ? arg.split('=').slice(1).join('=') : undefined
}

function parseArgs(): AgentConfig {
  const dev  = getArg('dev')
  const task = getArg('task')
  if (!dev)  throw new Error('Missing required arg: --dev=<devId>')
  if (!task) throw new Error('Missing required arg: --task=<description>')

  return {
    dev,
    task,
    mode:      (getArg('mode') as AgentMode | undefined) ?? 'smart',
    serverUrl: getArg('server') ?? 'http://localhost:3000',
    workspace: getArg('workspace') ?? `./packages/demo/workspace-${dev}`,
  }
}

runAgent(parseArgs()).catch(err => {
  console.error('[agent] Fatal:', err instanceof Error ? err.message : err)
  process.exit(1)
})
