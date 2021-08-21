const Router = require('express-promise-router')
const Ably = require('ably')
const ably = new Ably.Realtime(process.env.ABLY_AKY_KEY)

const { db } = require('./db')

const router = new Router()

module.exports = router

router.get('/', async (req, res) => {
  let result
  if (isProduction) {
    const { FLY_APP_NAME: appName, FLY_REGION: runningRegion } = process.env
    const edgeNodeRegion = req.get('Fly-Region')

    result = { env: 'prod', appName, runningRegion, edgeNodeRegion }
  } else {
    result = { env: 'dev' }
  }

  res.json(result)
})

router.post('/create-list-id', async (req, res) => {
  const { list_id: listID } = req.query

  try {
    await db.tx(async (t) => {
      let list

      if (listID == null) {
        list = await t.oneOrNone('select id from todo_lists where id = $1', [
          listID,
        ])
      }

      if (list == null) {
        list = await t.one('insert into todo_lists default values returning id')
      }

      res.json({
        listID: list.id,
      })
    })
  } catch (e) {
    console.error(e)
    res.status(500).send(e.toString())
  }
})

router.post('/replicache-pull', async (req, res) => {
  const pull = req.body
  const { list_id: listID } = req.query

  try {
    await db.tx(async (t) => {
      const region = await getRegion(t, listID)

      const lastMutationID = parseInt(
        (
          await t.oneOrNone(
            'select last_mutation_id from replicache_clients where id = $1',
            [pull.clientID],
          )
        )?.last_mutation_id ?? '0',
      )

      const changed = await t.manyOrNone(
        'select id, completed, content, ord, deleted, version, client_side_id from todos where crdb_region = $1 and list_id = $2',
        [region, listID],
      )

      const patch = []

      const cookie = {}

      if (pull.cookie == null) {
        patch.push({ op: 'clear' })
      }

      changed.forEach(
        ({ id, completed, content, ord, version, deleted, client_side_id }) => {
          cookie[id] = version

          const key = `todo/${client_side_id}`

          if (pull.cookie == null || pull.cookie[id] !== version) {
            if (deleted) {
              patch.push({
                op: 'del',
                key,
              })
            } else {
              patch.push({
                op: 'put',
                key,
                value: {
                  id,
                  completed,
                  content,
                  clientSideID: client_side_id,
                  order: ord,
                },
              })
            }
          }
        },
      )

      res.json({ lastMutationID, cookie, patch })
      res.end()
    })
  } catch (e) {
    console.error(e)
    res.status(500).send(e.toString())
  }
})

router.post('/replicache-push', async (req, res) => {
  const { list_id: listID } = req.query
  const push = req.body

  try {
    await db.tx(async (t) => {
      const region = await getRegion(t, listID)

      let lastMutationID = await getLastMutationID(t, push.clientID)

      for (const mutation of push.mutations) {
        const expectedMutationID = lastMutationID + 1

        if (mutation.id < expectedMutationID) {
          console.log(
            `Mutation ${mutation.id} has already been processed - skipping`,
          )
          continue
        }

        if (mutation.id > expectedMutationID) {
          console.warn(`Mutation ${mutation.id} is from the future - aborting`)
          break
        }

        switch (mutation.name) {
          case 'createTodo':
            await createTodo(t, mutation.args, listID, region)
            break
          case 'updateTodoCompleted':
            await updateTodoCompleted(t, mutation.args)
            break
          case 'updateTodoOrder':
            await updateTodoOrder(t, mutation.args)
            break
          case 'deleteTodo':
            await deleteTodo(t, mutation.args)
            break
          default:
            throw new Error(`Unknown mutation: ${mutation.name}`)
        }
        lastMutationID = expectedMutationID
      }

      const channel = ably.channels.get(`todos-of-${listID}`)
      channel.publish('change', {})

      await t.none(
        'UPDATE replicache_clients SET last_mutation_id = $1 WHERE crdb_region = $2 and id = $3',
        [lastMutationID, region, push.clientID],
      )

      res.send('{}')
    })
  } catch (e) {
    console.error(e)
    res.status(500).send(e.toString())
  }
})

async function getLastMutationID(t, clientID) {
  const client = await t.oneOrNone(
    'SELECT last_mutation_id FROM replicache_clients WHERE id = $1',
    [clientID],
  )
  if (client != null) {
    return parseInt(client.last_mutation_id)
  }
  await t.none(
    'INSERT INTO replicache_clients (id, last_mutation_id) VALUES ($1, 0)',
    [clientID],
  )
  return 0
}

async function createTodo(
  t,
  { clientSideID, completed, content, order },
  listID,
  region,
) {
  await t.none(
    `INSERT INTO todos (
     client_side_id, completed, content, ord, list_id, crdb_region) values
     ($1, $2, $3, $4, $5, $6)`,
    [clientSideID, completed, content, order, listID, region],
  )
}

async function updateTodoCompleted(t, { id, completed }) {
  await t.none(
    `UPDATE todos
     SET completed = $2, version = gen_random_uuid()
     WHERE id = $1
     `,
    [id, completed],
  )
}

async function updateTodoOrder(t, { id, order }) {
  await t.none(
    `UPDATE todos
     SET ord = $2, version = gen_random_uuid()
     WHERE id = $1
     `,
    [id, order],
  )
}

async function deleteTodo(t, { id }) {
  await t.none(
    `UPDATE todos
     SET deleted = true, version = gen_random_uuid()
     WHERE id = $1
     `,
    [id],
  )
}

async function getRegion(t, listID) {
  const list = await t.one('select crdb_region from todo_lists where id = $1', [
    listID,
  ])

  return list.crdb_region
}
