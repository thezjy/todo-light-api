const pgInit = require('pg-promise')

const pgp = pgInit()

module.exports = {
  db: pgp(process.env.DATABASE_URL),
}
