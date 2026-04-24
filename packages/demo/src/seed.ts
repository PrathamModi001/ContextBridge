import fs from 'fs'
import path from 'path'

const AUTH_TS = `export async function validateUser(id: string): Promise<{ id: string; name: string }> {
  return { id, name: 'user' }
}

export type Permission = 'read' | 'write' | 'admin'

export interface AuthConfig {
  secret: string
  ttl: number
  maxAttempts?: number
}
`

const USER_SERVICE_TS = `import { validateUser, type Permission } from './auth'

export class UserService {
  async getUser(id: string) {
    return validateUser(id)
  }

  async checkPermission(userId: string, _permission: Permission): Promise<boolean> {
    const user = await validateUser(userId)
    return !!user
  }
}

export async function getUser(id: string): Promise<{ id: string; name: string }> {
  return validateUser(id)
}
`

const WORKSPACES = ['workspace-devA', 'workspace-devB']
const FILES = [
  { name: 'auth.ts',         content: AUTH_TS },
  { name: 'user.service.ts', content: USER_SERVICE_TS },
]

const demoRoot = path.resolve(__dirname, '..')

for (const ws of WORKSPACES) {
  const wsPath = path.join(demoRoot, ws)
  fs.mkdirSync(wsPath, { recursive: true })

  for (const file of FILES) {
    const filePath = path.join(wsPath, file.name)
    fs.writeFileSync(filePath, file.content, 'utf8')
    console.log(`[seed] ${ws}/${file.name}`)
  }
}

console.log('[seed] Workspaces ready')
