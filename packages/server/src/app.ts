import express from 'express'
import helmet from 'helmet'
import cors from 'cors'
import cookieParser from 'cookie-parser'
import rateLimit from 'express-rate-limit'
import router from './routes/router'
import { ApiError, globalErrorHandler } from './middlewares/errorHandler'

const app = express()

app.use(helmet())
app.use(cors())
app.use(express.json())
app.use(cookieParser())

const parseLimiter = rateLimit({
  windowMs: 60_000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests' },
})

const apiLimiter = rateLimit({
  windowMs: 60_000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests' },
})

app.use('/v1/context/validate', parseLimiter)
app.use('/v1', apiLimiter)
app.use('/v1', router)

app.use((_req, _res, next) => {
  next(new ApiError(404, 'Not Found'))
})

app.use(globalErrorHandler)

export default app
