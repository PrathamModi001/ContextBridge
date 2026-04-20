import express from 'express'
import helmet from 'helmet'
import cors from 'cors'
import cookieParser from 'cookie-parser'
import router from './routes/router'
import { ApiError, globalErrorHandler } from './middlewares/errorHandler'

const app = express()

app.use(helmet())
app.use(cors())
app.use(express.json())
app.use(cookieParser())

app.use('/v1', router)

app.use((_req, _res, next) => {
  next(new ApiError(404, 'Not Found'))
})

app.use(globalErrorHandler)

export default app
