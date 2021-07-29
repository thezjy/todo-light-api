/* eslint-disable camelcase */

exports.shorthands = undefined

exports.up = (pgm) => {
  pgm.renameColumn('todos', 'user_id', 'list_id')
}

exports.down = (pgm) => {
  pgm.renameColumn('todos', 'list_id', 'user_id')
}
