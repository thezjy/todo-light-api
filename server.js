require('dotenv').config()
const express = require('express')
const cors = require('cors')
const helmet = require('helmet')
const { execSync } = require('child_process')
const fs = require('fs')
const morgan = require('morgan')
const https = require('https')

const router = require('./router')

const COCKROACH_CERT_PATH = '/data/close-bison-ca.crt'

const isProduction = process.env.FLY_APP_NAME != null

if (isProduction) {
  downloadCockroachCert(start)
} else {
  start()
}

function start() {
  const { PORT } = process.env

  const app = express()

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
}

function downloadCockroachCert(start) {
  if (!fs.existsSync(COCKROACH_CERT_PATH)) {
    console.log('try download cockroach cert')

    https.get(
      'https://cockroachlabs.cloud/clusters/a0d63d14-0733-4ebe-9a7d-361d540a4db2/cert',
      (res) => {
        const filePath = fs.createWriteStream(COCKROACH_CERT_PATH)
        res.pipe(filePath)
        filePath.on('finish', () => {
          filePath.close()
          console.log('download cockroach cert successful')
          start()
        })
      },
    )
  } else {
    start()
  }
}
