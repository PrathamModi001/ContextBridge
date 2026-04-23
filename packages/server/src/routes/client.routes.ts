import { Router, Request, Response, NextFunction } from 'express'
import { getRedisClient } from '../config/redis'

export async function getClientEntitiesHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const entities = await getRedisClient().smembers(`client:${req.params.devId}:entities`)
    res.json({ devId: req.params.devId, entities })
  } catch (err) {
    next(err)
  }
}

const router = Router()
router.get('/:devId/entities', getClientEntitiesHandler)
export default router
