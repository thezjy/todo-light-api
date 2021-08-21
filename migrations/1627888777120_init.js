exports.shorthands = undefined

exports.up = (pgm) => {
  pgm.createTable('todo_lists', {
    id: {
      type: 'uuid',
      notNull: true,
      primaryKey: true,
      default: pgm.func('gen_random_uuid()'),
    },
  })

  pgm.createTable('todos', {
    id: {
      type: 'uuid',
      notNull: true,
      primaryKey: true,
      default: pgm.func('gen_random_uuid()'),
    },
    client_side_id: {
      type: 'varchar(21)',
      notNull: true,
    },
    list_id: {
      type: 'uuid',
      notNull: true,
      references: 'todo_lists',
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
  pgm.dropTable('todo_lists')
  pgm.dropTable('replicache_clients')
}
