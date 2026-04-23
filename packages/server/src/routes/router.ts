import { Router } from 'express'
import entityRoutes from './entity.routes'
import clientRoutes from './client.routes'
import conflictRoutes from './conflict.routes'

const router = Router()

router.get('/health', (_req, res) => {
  res.json({ status: 'ok', ts: Date.now() })
})

router.use('/entities', entityRoutes)
router.use('/clients', clientRoutes)
router.use('/conflicts', conflictRoutes)

export default router
