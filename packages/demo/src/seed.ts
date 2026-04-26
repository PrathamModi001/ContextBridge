import fs from 'fs'
import path from 'path'

const AUTH_TS = `import { createSession } from './sessions'
import { getUserByEmail } from './users'

export async function loginUser(
  email: string,
  password: string,
): Promise<{ token: string; refreshToken: string; userId: string } | null> {
  const user = await getUserByEmail(email)
  if (!user) return null
  const isValid = await verifyPassword(password, user.passwordHash)
  if (!isValid) return null
  const session = await createSession(user.id)
  return { token: session.token, refreshToken: session.refreshToken, userId: user.id }
}

export async function logoutUser(userId: string, token: string): Promise<void> {
  void userId
  void token
  // revoke session
}

export async function refreshAccessToken(refreshToken: string): Promise<{ token: string } | null> {
  void refreshToken
  return null
}

export function hashPassword(plain: string): string {
  return Buffer.from(plain + 'salt').toString('base64')
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return hashPassword(plain) === hash
}

export function generateToken(userId: string): string {
  return Buffer.from(\`\${userId}:\${Date.now()}\`).toString('base64url')
}
`

const USERS_TS = `export interface User {
  id:           string
  email:        string
  name:         string
  passwordHash: string
  role:         'admin' | 'user' | 'guest'
  createdAt:    Date
  updatedAt:    Date
  deletedAt?:   Date
}

export type CreateUserInput = Pick<User, 'email' | 'name'> & { password: string }

const store = new Map<string, User>()

export async function getUserById(id: string): Promise<User | null> {
  return store.get(id) ?? null
}

export async function getUserByEmail(email: string): Promise<User | null> {
  for (const user of store.values()) {
    if (user.email === email) return user
  }
  return null
}

export async function createUser(input: CreateUserInput): Promise<User> {
  const { hashPassword } = await import('./auth')
  const user: User = {
    id:           Math.random().toString(36).slice(2),
    email:        input.email,
    name:         input.name,
    passwordHash: hashPassword(input.password),
    role:         'user',
    createdAt:    new Date(),
    updatedAt:    new Date(),
  }
  store.set(user.id, user)
  return user
}

export async function updateUser(
  id: string,
  data: Partial<Pick<User, 'name' | 'email' | 'role'>>,
): Promise<User | null> {
  const user = store.get(id)
  if (!user) return null
  const updated = { ...user, ...data, updatedAt: new Date() }
  store.set(id, updated)
  return updated
}

export async function deleteUser(id: string): Promise<void> {
  store.delete(id)
}

export async function listUsers(
  page: number,
  limit: number,
): Promise<{ users: User[]; total: number }> {
  const all = [...store.values()]
  const start = (page - 1) * limit
  return { users: all.slice(start, start + limit), total: all.size }
}
`

const SESSIONS_TS = `import { generateToken } from './auth'

export interface Session {
  id:           string
  userId:       string
  token:        string
  refreshToken: string
  expiresAt:    Date
  createdAt:    Date
  revoked:      boolean
}

const sessions = new Map<string, Session>()

export async function createSession(userId: string): Promise<Session> {
  const session: Session = {
    id:           Math.random().toString(36).slice(2),
    userId,
    token:        generateToken(userId),
    refreshToken: generateToken(userId + ':refresh'),
    expiresAt:    new Date(Date.now() + 24 * 60 * 60 * 1000),
    createdAt:    new Date(),
    revoked:      false,
  }
  sessions.set(session.id, session)
  return session
}

export async function validateSession(sessionId: string): Promise<Session | null> {
  const session = sessions.get(sessionId)
  if (!session || session.revoked || session.expiresAt < new Date()) return null
  return session
}

export async function revokeSession(sessionId: string): Promise<void> {
  const session = sessions.get(sessionId)
  if (session) sessions.set(sessionId, { ...session, revoked: true })
}

export async function revokeAllUserSessions(userId: string): Promise<void> {
  for (const [id, session] of sessions) {
    if (session.userId === userId) sessions.set(id, { ...session, revoked: true })
  }
}

export async function listActiveSessions(userId: string): Promise<Session[]> {
  return [...sessions.values()].filter(
    s => s.userId === userId && !s.revoked && s.expiresAt > new Date(),
  )
}
`

const PERMISSIONS_TS = `export type Action   = 'read' | 'write' | 'delete' | 'admin'
export type Resource = 'users' | 'sessions' | 'reports' | 'settings'

export interface Permission {
  userId:   string
  resource: Resource
  action:   Action
}

const perms = new Map<string, Set<string>>()

function key(resource: Resource, action: Action) { return \`\${resource}:\${action}\` }

export async function checkPermission(
  userId: string,
  resource: Resource,
  action: Action,
): Promise<boolean> {
  return perms.get(userId)?.has(key(resource, action)) ?? false
}

export async function grantPermission(
  userId: string,
  resource: Resource,
  action: Action,
): Promise<void> {
  if (!perms.has(userId)) perms.set(userId, new Set())
  perms.get(userId)!.add(key(resource, action))
}

export async function revokePermission(
  userId: string,
  resource: Resource,
  action: Action,
): Promise<void> {
  perms.get(userId)?.delete(key(resource, action))
}

export async function getUserPermissions(userId: string): Promise<Permission[]> {
  const keys = [...(perms.get(userId) ?? [])]
  return keys.map(k => {
    const [resource, action] = k.split(':')
    return { userId, resource: resource as Resource, action: action as Action }
  })
}
`

const FILES: Record<string, string> = {
  'auth.ts':        AUTH_TS,
  'users.ts':       USERS_TS,
  'sessions.ts':    SESSIONS_TS,
  'permissions.ts': PERMISSIONS_TS,
}

const WORKSPACES = ['workspace-devA', 'workspace-devB']
const demoRoot   = path.resolve(__dirname, '..')

for (const ws of WORKSPACES) {
  const wsPath = path.join(demoRoot, ws)
  fs.mkdirSync(wsPath, { recursive: true })
  for (const [name, content] of Object.entries(FILES)) {
    fs.writeFileSync(path.join(wsPath, name), content, 'utf8')
    console.log(`[seed] ${ws}/${name}`)
  }
}

console.log('[seed] Workspaces ready')
