const Router = require('express-promise-router')
const Ably = require('ably')
const ably = new Ably.Realtime(process.env.ABLY_AKY_KEY)

const { db } = require('./db')

const isProduction = process.env.FLY_APP_NAME != null
const READ_ONLY_SQL_TRANSACTION = 25006

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

router.post('/replicache-pull', async (req, res) => {
  const pull = req.body
  const { list_id: listID } = req.query
  console.log(`Processing pull`, JSON.stringify(pull))
  const t0 = Date.now()

  try {
    await db.tx(async (t) => {
      const lastMutationID = parseInt(
        (
          await t.oneOrNone(
            'select last_mutation_id from replicache_clients where id = $1',
            pull.clientID,
          )
        )?.last_mutation_id ?? '0',
      )

      const changed = await t.manyOrNone(
        'select id, completed, content, ord, deleted, version from todos where list_id = $1',
        listID,
      )

      const patch = []

      const cookie = {}

      if (pull.cookie == null) {
        patch.push({ op: 'clear' })
      }

      changed.forEach(({ id, completed, content, ord, version, deleted }) => {
        cookie[id] = version

        const key = `todo/${id}`

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
                order: ord,
              },
            })
          }
        }
      })

      res.json({ lastMutationID, cookie, patch })
      res.end()
    })
  } catch (e) {
    console.error(e)
    res.status(500).send(e.toString())
  } finally {
    console.log('Processed pull in', Date.now() - t0)
  }
})

router.post('/replicache-push', async (req, res) => {
  const { list_id: listID } = req.query
  const push = req.body
  console.log('Processing push', JSON.stringify(push))
  const t0 = Date.now()

  try {
    await db.tx(async (t) => {
      let lastMutationID = await getLastMutationID(t, push.clientID)

      for (const mutation of push.mutations) {
        const t1 = Date.now()
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

        console.log('Processing mutation:', JSON.stringify(mutation))

        switch (mutation.name) {
          case 'createTodo':
            await createTodo(t, mutation.args, listID)
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
        console.log('Processed mutation in', Date.now() - t1)
      }

      const channel = ably.channels.get(`todos-of-${listID}`)
      channel.publish('change', {})

      console.log(
        'setting',
        push.clientID,
        'last_mutation_id to',
        lastMutationID,
      )

      await t.none(
        'UPDATE replicache_clients SET last_mutation_id = $1 WHERE id = $2',
        [lastMutationID, push.clientID],
      )

      res.send('{}')
    })
  } catch (e) {
    console.error(e)

    // This should be handled at the application level.
    // We only deal with it at this route for simplicity's reason and because only this route *write* to the db.
    if ((e.code = READ_ONLY_SQL_TRANSACTION)) {
      const { PRIMARY_REGION: primary, FLY_REGION: current } = process.env

      res.set('fly-replay', `region=${primary}`)

      const replayMessage = `replaying from ${current} to ${primary}`

      console.log(replayMessage)

      res.status(409).send(replayMessage)
    } else {
      res.status(500).send(e.toString())
    }
  } finally {
    console.log('Processed push in', Date.now() - t0)
  }
})

async function getLastMutationID(t, clientID) {
  const clientRow = await t.oneOrNone(
    'SELECT last_mutation_id FROM replicache_clients WHERE id = $1',
    clientID,
  )

  if (clientRow) {
    return parseInt(clientRow.last_mutation_id)
  }

  await t.none(
    'INSERT INTO replicache_clients (id, last_mutation_id) VALUES ($1, 0)',
    clientID,
  )

  return 0
}

async function createTodo(t, { id, completed, content, order }, listID) {
  await t.none(
    `INSERT INTO todos (
     id, completed, content, ord, list_id) values
     ($1, $2, $3, $4, $5)`,
    [id, completed, content, order, listID],
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
