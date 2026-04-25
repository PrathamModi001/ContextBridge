import { Router, Request, Response, NextFunction } from 'express'
import { z } from 'zod'
import { getEntityHistory, getDevHistory, getRecentChanges } from '../services/audit/audit.service'
import { validateRequest } from '../middlewares/validateRequest'

const entityNameParams = z.object({ name: z.string().min(1).max(200) })
const devIdParams = z.object({ devId: z.string().min(1).max(100) })

function parseLimit(raw: unknown): number {
  const n = parseInt(raw as string, 10)
  return isNaN(n) || n < 1 ? 50 : Math.min(n, 200)
}

export async function getEntityHistoryHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const limit = parseLimit(req.query.limit)
    const records = await getEntityHistory(req.params.name, limit)
    res.json(records)
  } catch (err) {
    next(err)
  }
}

export async function getDevHistoryHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const limit = parseLimit(req.query.limit)
    const records = await getDevHistory(req.params.devId, limit)
    res.json(records)
  } catch (err) {
    next(err)
  }
}

export async function getRecentChangesHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const limit = parseLimit(req.query.limit)
    const records = await getRecentChanges(limit)
    res.json(records)
  } catch (err) {
    next(err)
  }
}

const router = Router()
router.get('/entities/:name', validateRequest({ params: entityNameParams }), getEntityHistoryHandler)
router.get('/devs/:devId', validateRequest({ params: devIdParams }), getDevHistoryHandler)
router.get('/recent', getRecentChangesHandler)
export default router
