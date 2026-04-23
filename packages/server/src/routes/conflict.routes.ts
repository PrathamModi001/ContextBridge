import { Router, Request, Response, NextFunction } from 'express'
import { getRedisClient } from '../config/redis'

export async function getConflictsHandler(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const raw = await getRedisClient().lrange('conflicts:recent', 0, 99)
    const conflicts = raw.map((s: string) => JSON.parse(s) as unknown)
    res.json(conflicts)
  } catch (err) {
    next(err)
  }
}

const router = Router()
router.get('/', getConflictsHandler)
export default router
