exports.shorthands = undefined

exports.up = (pgm) => {
  pgm.createTable('users', {
    id: {
      type: 'varchar(21)',
      notNull: true,
      primaryKey: true,
    },
  })

  pgm.createTable('todos', {
    id: {
      type: 'varchar(21)',
      notNull: true,
      primaryKey: true,
    },
    user_id: {
      type: 'varchar(21)',
      notNull: true,
      references: '"users"',
      onDelete: 'cascade',
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
      type: 'uuid',
      notNull: true,
      default: pgm.func('gen_random_uuid()'),
    },
  })

  pgm.createTable('replicache_clients', {
    id: {
      type: 'uuid',
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
  pgm.dropTable('todos')
  pgm.dropTable('users')
  pgm.dropTable('replicache_clients')
}
