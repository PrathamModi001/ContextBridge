import { Router, Request, Response, NextFunction } from 'express'
import { getRedisClient } from '../config/redis'
import { getImpactCount, getDependents, getEntityClients } from '../services/graph/graph.service'
import { notFound } from '../middlewares/errorHandler'

export async function getEntityHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const redis = getRedisClient()
    const fields = await redis.hgetall(`entity:${req.params.name}`)
    if (!fields || Object.keys(fields).length === 0) {
      return void next(notFound(`Entity '${req.params.name}' not found`))
    }
    res.json({ ...fields, line: parseInt(fields.line, 10) })
  } catch (err) {
    next(err)
  }
}

export async function getEntityImpactHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const impactCount = await getImpactCount(req.params.name)
    res.json({ entityName: req.params.name, impactCount })
  } catch (err) {
    next(err)
  }
}

export async function getEntityDependentsHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const dependents = await getDependents(req.params.name)
    res.json({ entityName: req.params.name, dependents })
  } catch (err) {
    next(err)
  }
}

export async function getEntityClientsHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const clients = await getEntityClients(req.params.name)
    res.json({ entityName: req.params.name, clients })
  } catch (err) {
    next(err)
  }
}

const router = Router()
router.get('/:name', getEntityHandler)
router.get('/:name/impact', getEntityImpactHandler)
router.get('/:name/dependents', getEntityDependentsHandler)
router.get('/:name/clients', getEntityClientsHandler)
export default router
