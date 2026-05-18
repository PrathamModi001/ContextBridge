import fs from 'fs'
import path from 'path'
import { FINTECH_FILES_A, FINTECH_FILES_B } from './fintech-seed'

const demoRoot = path.resolve(__dirname, '..')

const WORKSPACES: Array<{ name: string; files: Record<string, string> }> = [
  { name: 'workspace-devA', files: FINTECH_FILES_A },
  { name: 'workspace-devB', files: FINTECH_FILES_B },
]

for (const { name, files } of WORKSPACES) {
  const wsPath = path.join(demoRoot, name)
  fs.mkdirSync(wsPath, { recursive: true })
  // Remove stale .ts files so old files don't linger after seed content changes
  for (const f of fs.readdirSync(wsPath)) {
    if (f.endsWith('.ts')) fs.unlinkSync(path.join(wsPath, f))
  }
  for (const [filename, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(wsPath, filename), content, 'utf8')
    console.log(`[seed] ${name}/${filename}`)
  }
}

console.log('[seed] Workspaces ready')
