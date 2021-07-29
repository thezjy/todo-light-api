require('dotenv').config()
const express = require('express')
const cors = require('cors')
const helmet = require('helmet')
const router = require('./router')

const { PORT } = process.env

const app = express()

app.use(express.json())
app.use(express.urlencoded())
app.use(cors())
app.use(helmet())
app.use(router)

app.listen(PORT, () => {
  console.log(`Listening on port ${PORT}`)
})
