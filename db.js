const pgInit = require('pg-promise')

const pgp = pgInit()

// https://fly.io/docs/getting-started/multi-region-databases/
function getFlyRegionalPostgresURL() {
  const {
    PRIMARY_REGION: primary,
    FLY_REGION: current,
    DATABASE_URL: dbURL,
  } = process.env

  if (primary == null || current == null || primary === current) {
    return dbURL
  }

  const url = new URL(dbURL)

  url.hostname = `${current}.${url.hostname}`
  url.port = 5433

  const result = url.toString()

  console.info('database url', result)

  return result
}

module.exports = {
  db: pgp(getFlyRegionalPostgresURL()),
}
