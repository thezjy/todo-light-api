/* eslint-disable camelcase */

exports.shorthands = undefined

exports.up = (pgm) => {
  pgm.createSequence('todo_version')

  pgm.createTable('todos', {
    id: {
      type: 'varchar(21)',
      notNull: true,
      primaryKey: true,
    },
    group_id: {
      type: 'varchar(21)',
      notNull: true,
    },
    content: {
      type: 'string',
      notNull: true,
    },
    completed: {
      type: 'bool',
      notNull: true,
    },
    deleted: {
      type: 'bool',
      notNull: true,
      default: false,
    },
    ord: {
      type: 'string',
      notNull: true,
    },
    version: {
      type: 'int8',
      notNull: true,
    },
  })

  pgm.createIndex('todos', ['group_id'])
  pgm.createIndex('todos', ['id', 'group_id'])

  pgm.createTable('replicache_clients', {
    id: {
      type: 'varchar(36)',
      notNull: true,
      primaryKey: true,
    },
    last_mutation_id: {
      type: 'int8',
      notNull: true,
    },
  })
}

exports.down = (pgm) => {
  pgm.dropSequence('todo_version')
  pgm.dropTable('todos')
  pgm.dropTable('replicache_clients')
}
