export const FINTECH_FILES: Record<string, string> = {
  'types.ts': `export interface Account {
  id: string; userId: string; accountNumber: string
  balance: number; currency: 'USD' | 'EUR' | 'GBP'
  status: 'active' | 'frozen' | 'closed' | 'pending_kyc'
  kycVerified: boolean; dailyLimit: number
  createdAt: Date; updatedAt: Date
}
export interface Transaction {
  id: string; fromAccountId: string; toAccountId: string
  amount: number; currency: string
  type: 'transfer' | 'deposit' | 'withdrawal' | 'fee' | 'refund'
  status: 'pending' | 'completed' | 'failed' | 'reversed'
  description: string; metadata: Record<string, unknown>
  processedAt: Date | null; createdAt: Date
}
export interface Payment {
  id: string; accountId: string; amount: number; currency: string
  method: 'card' | 'bank_transfer' | 'crypto'
  status: 'pending' | 'authorized' | 'captured' | 'failed' | 'refunded'
  processorId: string; processorResponse: Record<string, unknown>; createdAt: Date
}
export interface Session {
  id: string; userId: string; token: string; scope: string[]
  expiresAt: Date; createdAt: Date; revoked: boolean
}
export interface KYCRecord {
  userId: string
  status: 'pending' | 'approved' | 'rejected' | 'expired'
  verifiedAt: Date | null; documents: string[]
  riskLevel: 'low' | 'medium' | 'high'
}
export interface RiskScore {
  transactionId: string; score: number; factors: string[]
  recommendation: 'allow' | 'review' | 'block'
}
export interface AuditLog {
  id: string; action: string; actorId: string
  targetId: string; targetType: string
  metadata: Record<string, unknown>; timestamp: Date
}
`,

  'auth.service.ts': `import { Session } from './types'
const sessions = new Map<string, Session>()

export function validateToken(token: string): Session | null {
  const session = [...sessions.values()].find(s => s.token === token)
  if (!session || session.revoked || session.expiresAt < new Date()) return null
  return session
}
export function requireScope(session: Session, requiredScope: string): boolean {
  return session.scope.includes(requiredScope)
}
export async function createSession(userId: string, scope: string[]): Promise<Session> {
  const session: Session = {
    id: Math.random().toString(36).slice(2), userId,
    token: Buffer.from(\`\${userId}:\${Date.now()}:\${Math.random()}\`).toString('base64url'),
    scope, expiresAt: new Date(Date.now() + 86_400_000),
    createdAt: new Date(), revoked: false,
  }
  sessions.set(session.id, session)
  return session
}
export async function revokeToken(token: string): Promise<void> {
  const s = [...sessions.values()].find(s => s.token === token)
  if (s) sessions.set(s.id, { ...s, revoked: true })
}
export async function refreshToken(token: string): Promise<Session | null> {
  const old = validateToken(token)
  if (!old) return null
  await revokeToken(token)
  return createSession(old.userId, old.scope)
}
`,

  'account.service.ts': `import { Account } from './types'
import { validateToken, requireScope } from './auth.service'
import { logTransaction } from './audit.service'
import { checkCompliance } from './kyc.service'
const accounts = new Map<string, Account>()

export async function getAccount(accountId: string, token: string): Promise<Account | null> {
  const session = validateToken(token)
  if (!session) throw new Error('Unauthorized')
  return accounts.get(accountId) ?? null
}
export async function getBalance(accountId: string, token: string): Promise<number> {
  const account = await getAccount(accountId, token)
  if (!account) throw new Error('Account not found')
  return account.balance
}
export async function createAccount(userId: string, currency: Account['currency'], token: string): Promise<Account> {
  const session = validateToken(token)
  if (!session || !requireScope(session, 'accounts:write')) throw new Error('Forbidden')
  if (!await checkCompliance(userId)) throw new Error('KYC required')
  const account: Account = {
    id: Math.random().toString(36).slice(2), userId,
    accountNumber: \`ACC\${Date.now()}\`, balance: 0, currency,
    status: 'active', kycVerified: true, dailyLimit: 10_000,
    createdAt: new Date(), updatedAt: new Date(),
  }
  accounts.set(account.id, account)
  await logTransaction('account.created', userId, account.id, 'account', {})
  return account
}
export async function freezeAccount(accountId: string, reason: string, token: string): Promise<void> {
  const session = validateToken(token)
  if (!session || !requireScope(session, 'accounts:admin')) throw new Error('Forbidden')
  const account = accounts.get(accountId)
  if (!account) throw new Error('Account not found')
  accounts.set(accountId, { ...account, status: 'frozen', updatedAt: new Date() })
  await logTransaction('account.frozen', session.userId, accountId, 'account', { reason })
}
export async function updateAccountLimits(accountId: string, dailyLimit: number, token: string): Promise<Account> {
  const session = validateToken(token)
  if (!session || !requireScope(session, 'accounts:admin')) throw new Error('Forbidden')
  const account = accounts.get(accountId)
  if (!account) throw new Error('Account not found')
  const updated = { ...account, dailyLimit, updatedAt: new Date() }
  accounts.set(accountId, updated)
  return updated
}
`,

  'transaction.service.ts': `import { Transaction } from './types'
import { validateToken, requireScope } from './auth.service'
import { getAccount } from './account.service'
import { scoreRisk } from './fraud.service'
import { logTransaction } from './audit.service'
import { sendReceipt } from './notification.service'
const transactions = new Map<string, Transaction>()

export async function transfer(fromAccountId: string, toAccountId: string, amount: number, token: string): Promise<Transaction> {
  const session = validateToken(token)
  if (!session || !requireScope(session, 'transactions:write')) throw new Error('Forbidden')
  const [from, to] = await Promise.all([getAccount(fromAccountId, token), getAccount(toAccountId, token)])
  if (!from || !to) throw new Error('Account not found')
  if (from.status !== 'active') throw new Error('Account unavailable')
  if (from.balance < amount) throw new Error('Insufficient funds')
  if (amount > from.dailyLimit) throw new Error('Exceeds daily limit')
  const tx: Transaction = {
    id: Math.random().toString(36).slice(2),
    fromAccountId, toAccountId, amount, currency: from.currency,
    type: 'transfer', status: 'pending', description: \`Transfer to \${toAccountId}\`,
    metadata: {}, processedAt: null, createdAt: new Date(),
  }
  const risk = await scoreRisk(tx)
  if (risk.recommendation === 'block') throw new Error('Transaction blocked: fraud risk')
  transactions.set(tx.id, { ...tx, status: 'completed', processedAt: new Date() })
  await logTransaction('transfer.completed', session.userId, tx.id, 'transaction', { amount })
  await sendReceipt(session.userId, tx.id, amount)
  return transactions.get(tx.id)!
}
export async function deposit(accountId: string, amount: number, token: string): Promise<Transaction> {
  const session = validateToken(token)
  if (!session || !requireScope(session, 'transactions:write')) throw new Error('Forbidden')
  const account = await getAccount(accountId, token)
  if (!account) throw new Error('Account not found')
  const tx: Transaction = {
    id: Math.random().toString(36).slice(2), fromAccountId: 'external', toAccountId: accountId,
    amount, currency: account.currency, type: 'deposit', status: 'completed',
    description: 'Deposit', metadata: {}, processedAt: new Date(), createdAt: new Date(),
  }
  transactions.set(tx.id, tx)
  await logTransaction('deposit.completed', session.userId, tx.id, 'transaction', { amount })
  return tx
}
export async function withdraw(accountId: string, amount: number, token: string): Promise<Transaction> {
  const session = validateToken(token)
  if (!session || !requireScope(session, 'transactions:write')) throw new Error('Forbidden')
  const account = await getAccount(accountId, token)
  if (!account || account.balance < amount) throw new Error('Insufficient funds')
  const tx: Transaction = {
    id: Math.random().toString(36).slice(2), fromAccountId: accountId, toAccountId: 'external',
    amount, currency: account.currency, type: 'withdrawal', status: 'completed',
    description: 'Withdrawal', metadata: {}, processedAt: new Date(), createdAt: new Date(),
  }
  transactions.set(tx.id, tx)
  await logTransaction('withdrawal.completed', session.userId, tx.id, 'transaction', { amount })
  return tx
}
export async function getTransactionHistory(accountId: string, token: string): Promise<Transaction[]> {
  const session = validateToken(token)
  if (!session) throw new Error('Unauthorized')
  return [...transactions.values()].filter(t => t.fromAccountId === accountId || t.toAccountId === accountId)
}
export async function validateTransactionLimit(accountId: string, amount: number, token: string): Promise<boolean> {
  const account = await getAccount(accountId, token)
  if (!account) return false
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const spent = [...transactions.values()]
    .filter(t => t.fromAccountId === accountId && t.createdAt >= today && t.status === 'completed')
    .reduce((s, t) => s + t.amount, 0)
  return spent + amount <= account.dailyLimit
}
`,

  'payment.service.ts': `import { Payment } from './types'
import { validateToken, requireScope } from './auth.service'
import { getAccount } from './account.service'
import { scoreRisk } from './fraud.service'
import { logTransaction } from './audit.service'
import { notifyPaymentFailed } from './notification.service'
const payments = new Map<string, Payment>()

export async function chargeCard(accountId: string, amount: number, cardToken: string, authToken: string): Promise<Payment> {
  const session = validateToken(authToken)
  if (!session || !requireScope(session, 'payments:write')) throw new Error('Forbidden')
  const account = await getAccount(accountId, authToken)
  if (!account || account.status !== 'active') throw new Error('Account unavailable')
  const payment: Payment = {
    id: Math.random().toString(36).slice(2), accountId, amount,
    currency: account.currency, method: 'card', status: 'pending',
    processorId: \`proc_\${Math.random().toString(36).slice(2)}\`,
    processorResponse: {}, createdAt: new Date(),
  }
  const fakeTx = { id: payment.id, fromAccountId: accountId, toAccountId: 'processor', amount, currency: account.currency, type: 'fee' as const, status: 'pending' as const, description: '', metadata: {}, processedAt: null, createdAt: new Date() }
  const risk = await scoreRisk(fakeTx)
  if (risk.recommendation === 'block') {
    payments.set(payment.id, { ...payment, status: 'failed' })
    await notifyPaymentFailed(session.userId, payment.id, 'Fraud risk')
    throw new Error('Payment blocked')
  }
  payments.set(payment.id, { ...payment, status: 'captured', processorResponse: { authorized: true } })
  await logTransaction('payment.captured', session.userId, payment.id, 'payment', { amount })
  return payments.get(payment.id)!
}
export async function refund(paymentId: string, authToken: string): Promise<Payment> {
  const session = validateToken(authToken)
  if (!session || !requireScope(session, 'payments:write')) throw new Error('Forbidden')
  const payment = payments.get(paymentId)
  if (!payment || payment.status !== 'captured') throw new Error('Not refundable')
  const refunded = { ...payment, status: 'refunded' as const }
  payments.set(paymentId, refunded)
  await logTransaction('payment.refunded', session.userId, paymentId, 'payment', {})
  return refunded
}
export async function validatePaymentMethod(cardToken: string, authToken: string): Promise<boolean> {
  const session = validateToken(authToken)
  if (!session) throw new Error('Unauthorized')
  return cardToken.startsWith('tok_') && cardToken.length > 10
}
export async function processWebhook(processorId: string, event: Record<string, unknown>): Promise<void> {
  const payment = [...payments.values()].find(p => p.processorId === processorId)
  if (!payment) return
  if (event.type === 'payment.failed') payments.set(payment.id, { ...payment, status: 'failed', processorResponse: event })
}
export async function createPaymentIntent(accountId: string, amount: number, currency: string, authToken: string): Promise<{ intentId: string; clientSecret: string }> {
  const session = validateToken(authToken)
  if (!session || !requireScope(session, 'payments:write')) throw new Error('Forbidden')
  return { intentId: \`pi_\${Math.random().toString(36).slice(2)}\`, clientSecret: \`secret_\${Math.random().toString(36).slice(2)}\` }
}
`,

  'fraud.service.ts': `import { Transaction, RiskScore } from './types'
import { logTransaction } from './audit.service'
import { alertFraud } from './notification.service'
const blocked   = new Set<string>()
const flagged   = new Set<string>()

export async function scoreRisk(transaction: Transaction): Promise<RiskScore> {
  const factors: string[] = []; let score = 0
  if (transaction.amount > 5_000)  { score += 30; factors.push('high_amount') }
  if (transaction.amount > 10_000) { score += 30; factors.push('very_high_amount') }
  if (blocked.has(transaction.fromAccountId)) { score += 50; factors.push('blocked_account') }
  if (flagged.has(transaction.fromAccountId)) { score += 20; factors.push('flagged_account') }
  const recommendation: RiskScore['recommendation'] = score >= 70 ? 'block' : score >= 40 ? 'review' : 'allow'
  return { transactionId: transaction.id, score, factors, recommendation }
}
export async function flagTransaction(transactionId: string, reason: string): Promise<void> {
  flagged.add(transactionId)
  await logTransaction('fraud.flagged', 'system', transactionId, 'transaction', { reason })
  await alertFraud('compliance-team', transactionId, reason)
}
export async function blockAccount(accountId: string, reason: string): Promise<void> {
  blocked.add(accountId)
  await logTransaction('account.blocked', 'system', accountId, 'account', { reason })
  await alertFraud('compliance-team', accountId, \`Blocked: \${reason}\`)
}
export async function reviewFraudAlert(alertId: string, decision: 'clear' | 'escalate'): Promise<void> {
  await logTransaction('fraud.reviewed', 'compliance', alertId, 'alert', { decision })
  if (decision === 'clear') flagged.delete(alertId)
}
export async function updateRiskModel(thresholds: { highAmount: number; veryHighAmount: number }): Promise<void> {
  await logTransaction('risk.model.updated', 'system', 'global', 'config', thresholds)
}
`,

  'kyc.service.ts': `import { KYCRecord } from './types'
import { logTransaction } from './audit.service'
const records = new Map<string, KYCRecord>()

export async function verifyIdentity(userId: string, documents: string[]): Promise<KYCRecord> {
  const record: KYCRecord = { userId, status: 'pending', verifiedAt: null, documents, riskLevel: 'low' }
  records.set(userId, record)
  await logTransaction('kyc.submitted', userId, userId, 'kyc', { documentCount: documents.length })
  return record
}
export async function checkCompliance(userId: string): Promise<boolean> {
  return records.get(userId)?.status === 'approved' ?? false
}
export async function updateKYCStatus(userId: string, status: KYCRecord['status'], riskLevel: KYCRecord['riskLevel']): Promise<KYCRecord> {
  const existing = records.get(userId)
  if (!existing) throw new Error('KYC record not found')
  const updated: KYCRecord = { ...existing, status, riskLevel, verifiedAt: status === 'approved' ? new Date() : existing.verifiedAt }
  records.set(userId, updated)
  await logTransaction('kyc.status.updated', 'compliance', userId, 'kyc', { status, riskLevel })
  return updated
}
export async function requireKYC(userId: string): Promise<void> {
  if (!await checkCompliance(userId)) throw new Error(\`User \${userId} must complete KYC\`)
}
`,

  'audit.service.ts': `import { AuditLog } from './types'
const logs: AuditLog[] = []

export async function logTransaction(action: string, actorId: string, targetId: string, targetType: string, metadata: Record<string, unknown>): Promise<AuditLog> {
  const log: AuditLog = { id: Math.random().toString(36).slice(2), action, actorId, targetId, targetType, metadata, timestamp: new Date() }
  logs.push(log)
  return log
}
export async function generateReport(fromDate: Date, toDate: Date): Promise<AuditLog[]> {
  return logs.filter(l => l.timestamp >= fromDate && l.timestamp <= toDate)
}
export async function flagSuspicious(logId: string): Promise<void> {
  const log = logs.find(l => l.id === logId)
  if (log) log.metadata = { ...log.metadata, flagged: true, flaggedAt: new Date() }
}
export async function getAuditTrail(targetId: string): Promise<AuditLog[]> {
  return logs.filter(l => l.targetId === targetId).sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
}
`,

  'notification.service.ts': `export async function alertFraud(recipientId: string, transactionId: string, reason: string): Promise<void> {
  console.log(\`[FRAUD ALERT] \${recipientId}: \${transactionId} — \${reason}\`)
}
export async function sendReceipt(userId: string, transactionId: string, amount: number): Promise<void> {
  console.log(\`[RECEIPT] \${userId}: \${transactionId} — $\${amount}\`)
}
export async function notifyAccountFreeze(userId: string, accountId: string, reason: string): Promise<void> {
  console.log(\`[ACCOUNT FROZEN] \${userId}: \${accountId} — \${reason}\`)
}
export async function notifyPaymentFailed(userId: string, paymentId: string, reason: string): Promise<void> {
  console.log(\`[PAYMENT FAILED] \${userId}: \${paymentId} — \${reason}\`)
}
`,

  'db.ts': `export async function query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  void sql; void params; return []
}
export async function transaction<T>(fn: () => Promise<T>): Promise<T> { return fn() }
export async function withRetry<T>(fn: () => Promise<T>, maxAttempts = 3): Promise<T> {
  let last: Error | null = null
  for (let i = 0; i < maxAttempts; i++) { try { return await fn() } catch (e) { last = e as Error } }
  throw last
}
export async function withAuditLog<T>(action: string, actorId: string, fn: () => Promise<T>): Promise<T> {
  const result = await fn()
  console.log(\`[AUDIT] \${action} by \${actorId}\`)
  return result
}
`,
}
