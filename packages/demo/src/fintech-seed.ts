/** Files seeded into devA's workspace — payment & transaction domain */
export const FINTECH_FILES_A: Record<string, string> = {
  'types.ts': `export interface Account {
  id: string
  userId: string
  balance: number
  currency: 'USD' | 'EUR' | 'GBP'
  status: 'active' | 'frozen' | 'closed'
}
export interface Transaction {
  id: string
  fromAccountId: string
  toAccountId: string
  amount: number
  status: 'pending' | 'completed' | 'failed'
}
export interface Session {
  id: string
  userId: string
  token: string
  scope: string[]
  expiresAt: Date
  revoked: boolean
}
`,

  'payment.service.ts': `const payments = new Map<string, { id: string; amount: number; status: string }>()

export async function chargeCard(accountId: string, amount: number, authToken: string): Promise<string> {
  if (!authToken) throw new Error('Unauthorized')
  const id = Math.random().toString(36).slice(2)
  payments.set(id, { id, amount, status: 'captured' })
  return id
}
export async function processPayment(orderId: string, amount: number, authToken: string): Promise<boolean> {
  if (!authToken) throw new Error('Unauthorized')
  if (amount <= 0) return false
  payments.set(orderId, { id: orderId, amount, status: 'completed' })
  return true
}
export async function refund(paymentId: string, authToken: string): Promise<void> {
  if (!authToken) throw new Error('Unauthorized')
  const p = payments.get(paymentId)
  if (p) payments.set(paymentId, { ...p, status: 'refunded' })
}
`,

  'transaction.service.ts': `import { Transaction } from './types'
const transactions = new Map<string, Transaction>()

export async function transfer(fromAccountId: string, toAccountId: string, amount: number, authToken: string): Promise<Transaction> {
  if (!authToken) throw new Error('Unauthorized')
  const tx: Transaction = { id: Math.random().toString(36).slice(2), fromAccountId, toAccountId, amount, status: 'completed' }
  transactions.set(tx.id, tx)
  return tx
}
export async function deposit(accountId: string, amount: number, authToken: string): Promise<Transaction> {
  if (!authToken) throw new Error('Unauthorized')
  const tx: Transaction = { id: Math.random().toString(36).slice(2), fromAccountId: 'external', toAccountId: accountId, amount, status: 'completed' }
  transactions.set(tx.id, tx)
  return tx
}
export async function withdraw(accountId: string, amount: number, authToken: string): Promise<Transaction> {
  if (!authToken) throw new Error('Unauthorized')
  const tx: Transaction = { id: Math.random().toString(36).slice(2), fromAccountId: accountId, toAccountId: 'external', amount, status: 'completed' }
  transactions.set(tx.id, tx)
  return tx
}
`,
}

/** Files seeded into devB's workspace — auth & account domain */
export const FINTECH_FILES_B: Record<string, string> = {
  'types.ts': FINTECH_FILES_A['types.ts'],

  'auth.service.ts': `import { Session } from './types'
const sessions = new Map<string, Session>()

export function validateToken(token: string): Session | null {
  const session = [...sessions.values()].find(s => s.token === token)
  if (!session || session.revoked || session.expiresAt < new Date()) return null
  return session
}
export async function createSession(userId: string, scope: string[]): Promise<Session> {
  const session: Session = {
    id: Math.random().toString(36).slice(2), userId,
    token: Buffer.from(\`\${userId}:\${Date.now()}\`).toString('base64url'),
    scope, expiresAt: new Date(Date.now() + 86_400_000), revoked: false,
  }
  sessions.set(session.id, session)
  return session
}
export async function revokeToken(token: string): Promise<void> {
  const s = [...sessions.values()].find(s => s.token === token)
  if (s) sessions.set(s.id, { ...s, revoked: true })
}
`,

  'account.service.ts': `import { Account } from './types'
const accounts = new Map<string, Account>()

export async function getAccount(accountId: string): Promise<Account | null> {
  return accounts.get(accountId) ?? null
}
export async function createAccount(userId: string, currency: Account['currency']): Promise<Account> {
  const account: Account = {
    id: Math.random().toString(36).slice(2), userId, balance: 0,
    currency, status: 'active',
  }
  accounts.set(account.id, account)
  return account
}
export async function freezeAccount(accountId: string): Promise<void> {
  const account = accounts.get(accountId)
  if (!account) throw new Error('Account not found')
  accounts.set(accountId, { ...account, status: 'frozen' })
}
`,
}

/** Legacy export — union of both (used by demo:seed for initial workspace population) */
export const FINTECH_FILES: Record<string, string> = { ...FINTECH_FILES_A, ...FINTECH_FILES_B }
