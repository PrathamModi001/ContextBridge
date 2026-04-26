import { Router, Request, Response, NextFunction } from 'express'
import { getRedisClient } from '../config/redis'
import { getOpenSessions, getSession, markResolving } from '../services/conflict/conflict.session.service'
import { resolveConflictSession, getIo } from '../socket'
import { Resolution } from '../types'

export async function getConflictsHandler(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const raw       = await getRedisClient().lrange('conflicts:recent', 0, 99)
    const conflicts = raw.flatMap((s: string) => {
      try   { return [JSON.parse(s) as unknown] }
      catch { return [] }
    })
    res.json(conflicts)
  } catch (err) { next(err) }
}

export async function getSessionsHandler(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.json(await getOpenSessions())
  } catch (err) { next(err) }
}

export async function getSessionHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const session = await getSession(req.params.id)
    if (!session) { res.status(404).json({ error: 'Session not found' }); return }
    res.json(session)
  } catch (err) { next(err) }
}

export async function resolveSessionHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { type, mergedBody, mergedSig, resolvedBy } = req.body as Partial<Resolution>
    if (!type || !resolvedBy) {
      res.status(400).json({ error: 'type and resolvedBy are required' }); return
    }
    if (!['accepted_a', 'accepted_b', 'manual_merge'].includes(type)) {
      res.status(400).json({ error: 'type must be accepted_a | accepted_b | manual_merge' }); return
    }
    if (type === 'manual_merge' && (!mergedBody || !mergedSig)) {
      res.status(400).json({ error: 'mergedBody and mergedSig required for manual_merge' }); return
    }

    const session = await getSession(req.params.id)
    if (!session) { res.status(404).json({ error: 'Session not found' }); return }
    if (session.status !== 'open') { res.status(409).json({ error: 'Session already resolved or resolving' }); return }

    await markResolving(req.params.id, resolvedBy)
    getIo().to('room:dashboard').emit('conflict:session:resolving', { sessionId: req.params.id, resolvedBy })
    await resolveConflictSession(req.params.id, { type, mergedBody, mergedSig, resolvedBy })
    res.json({ ok: true })
  } catch (err) { next(err) }
}

const router = Router()
router.get('/',                      getConflictsHandler)
router.get('/sessions',              getSessionsHandler)
router.get('/sessions/:id',          getSessionHandler)
router.post('/sessions/:id/resolve', resolveSessionHandler)
export default router
