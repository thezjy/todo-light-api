require('dotenv').config()
const express = require('express')
const cors = require('cors')
const helmet = require('helmet')
const morgan = require('morgan')
const rateLimit = require('express-rate-limit')

const router = require('./router')

const isProduction = process.env.FLY_APP_NAME != null

const { PORT } = process.env

const app = express()

const limiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 1000,
  onLimitReached() {
    console.error('rate limit reached')
  },
})

app.use(limiter)
app.use(morgan(isProduction ? 'combined' : 'dev'))
app.use(express.json())
app.use(express.urlencoded())

// https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Access-Control-Max-Age
app.use(cors({ maxAge: 86400 }))

app.use(helmet())
app.use(router)

app.listen(PORT, () => {
  console.log(`Listening on port ${PORT}`)
})
