const Router = require('express-promise-router')
const Ably = require('ably')
const ably = new Ably.Realtime(process.env.ABLY_AKY_KEY)
const todoChannel = ably.channels.get('todo-change')

const { db } = require('./db')

const router = new Router()

module.exports = router

router.get('/', async (req, res) => {
  res.json({ ok: true })
})

router.post('/replicache-pull', async (req, res) => {
  const pull = req.body
  const { group_id: groupID } = req.query
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
        'select id, completed, content, ord, deleted from todos where group_id = $2 and version > $1',
        [parseInt(pull.cookie ?? 0), groupID],
      )
      const cookie = (
        await t.one(
          'select max(version) as version from todos where group_id = $1',
          groupID,
        )
      ).version

      console.log({ cookie, lastMutationID, changed })

      const patch = []

      if (pull.cookie === null) {
        patch.push({ op: 'clear' })
      }

      changed.forEach(({ id, completed, ord, content, deleted }) => {
        const key = `todo/${id}`

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
  const { group_id: groupID } = req.query
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

        const { nextval: version } = await t.one(
          "SELECT nextval('todo_version')",
        )
        console.log('Processing mutation:', JSON.stringify(mutation))
        switch (mutation.name) {
          case 'createTodo':
            await createTodo(t, mutation.args, version, groupID)
            break
          case 'updateTodoCompleted':
            await updateTodoCompleted(t, mutation.args, version)
            break
          case 'updateTodoOrder':
            await updateTodoOrder(t, mutation.args, version)
            break
          case 'deleteTodo':
            await deleteTodo(t, mutation.args, version)
            break
          default:
            throw new Error(`Unknown mutation: ${mutation.name}`)
        }
        lastMutationID = expectedMutationID
        console.log('Processed mutation in', Date.now() - t1)
      }

      await sendPoke(groupID)

      console.log(
        'setting',
        push.clientID,
        'last_mutation_id to',
        lastMutationID,
      )

      await t.none(
        'UPDATE replicache_clients SET last_mutation_id = $2 WHERE id = $1',
        [push.clientID, lastMutationID],
      )

      res.send('{}')
    })
  } catch (e) {
    console.error(e)
    res.status(500).send(e.toString())
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
  console.log('Creating new client', clientID)
  await t.none(
    'INSERT INTO replicache_clients (id, last_mutation_id) VALUES ($1, 0)',
    clientID,
  )
  return 0
}

async function createTodo(
  t,
  { id, completed, content, order },
  version,
  groupID,
) {
  await t.none(
    `INSERT INTO todos (
     id, completed, content, ord, version, group_id) values
     ($1, $2, $3, $4, $5, $6)`,
    [id, completed, content, order, version, groupID],
  )
}

async function updateTodoCompleted(t, { id, completed }, version) {
  await t.none(
    `UPDATE todos
     SET completed = $2, version = $3
     WHERE id = $1
     `,
    [id, completed, version],
  )
}

async function updateTodoOrder(t, { id, order }, version) {
  await t.none(
    `UPDATE todos
     SET ord = $2, version = $3
     WHERE id = $1
     `,
    [id, order, version],
  )
}

async function deleteTodo(t, { id }, version) {
  console.info('deleteTodo, id: ', id)
  await t.none(
    `UPDATE todos
     SET (deleted, version) =
     (true, $2)
     WHERE id = $1
     `,
    [id, version],
  )
}

async function sendPoke(groupID) {
  todoChannel.publish(groupID, {})
}
