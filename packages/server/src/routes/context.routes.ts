import { Router, Request, Response, NextFunction } from 'express'
import { z } from 'zod'
import { buildSnapshot, buildMarkdownSnapshot, validateCodeUsage } from '../services/context/context.service'
import { badRequest } from '../middlewares/errorHandler'
import { validateRequest } from '../middlewares/validateRequest'
import { getRedisClient } from '../config/redis'
import { getIo } from '../socket'

const validateUsageBody = z.object({ code: z.string().min(1).max(20_000) })
const snapshotQuery = z.object({
  format: z.enum(['json', 'markdown']).optional(),
  entity: z.string().min(1).max(200).optional(),
  depth: z.coerce.number().int().min(1).max(5).optional(),
})

export async function getSnapshotHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const format = (req.query.format as string) ?? 'json'
    const entity = req.query.entity as string | undefined
    const depthStr = req.query.depth as string | undefined
    const depth = depthStr !== undefined ? parseInt(depthStr, 10) : undefined
    if (depth !== undefined && isNaN(depth)) {
      return void next(badRequest('depth must be a valid integer'))
    }

    const snapshot = await buildSnapshot({ entity, depth })

    if (format === 'markdown') {
      res.type('text/markdown').send(buildMarkdownSnapshot(snapshot))
      return
    }

    res.json(snapshot)
  } catch (err) {
    next(err)
  }
}

export async function validateUsageHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { code } = req.body as { code?: unknown }
    if (!code || typeof code !== 'string' || code.trim().length === 0) {
      return void next(badRequest('code field is required and must be a non-empty string'))
    }
    if (code.length > 20_000) {
      return void next(badRequest('code field must be under 20,000 characters'))
    }

    const conflicts = await validateCodeUsage(code)
    res.json({ conflicts })
  } catch (err) {
    next(err)
  }
}

export async function flushHandler(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const redis = getRedisClient()
    await redis.del('conflicts:recent')
    getIo().to('room:dashboard').emit('conflicts:cleared')
    res.json({ ok: true })
  } catch (err) {
    next(err)
  }
}

const router = Router()
router.get('/snapshot', validateRequest({ query: snapshotQuery }), getSnapshotHandler)
router.post('/validate', validateRequest({ body: validateUsageBody }), validateUsageHandler)
router.post('/flush', flushHandler)
export default router
