import { Hono } from 'hono'
import { Client } from '@neondatabase/serverless'

type Bindings = {
  DATABASE_URL: string
}

const app = new Hono<{ Bindings: Bindings }>()

// 1. ZKTeco Device Handshake / Heartbeat
app.get('/iclock/cdata', (c) => {
  return c.text('OK')
})

app.get('/iclock/getrequest', (c) => {
  return c.text('OK')
})

// 2. Attendance Push Log Handler
app.post('/iclock/cdata', async (c) => {
  const rawData = await c.req.text()
  const table = c.req.query('table')

  // Only process if the table is ATTLOG (Attendance Log)
  if (table === 'ATTLOG') {
    const client = new Client(c.env.DATABASE_URL)
    await client.connect()

    // ZKTeco sends logs line-by-line separated by newlines (\n)
    // Format usually: [UserID]\t[Timestamp]\t[Status]\t[VerifyType]
    const lines = rawData.trim().split('\n')

    for (const line of lines) {
      const parts = line.split('\t')
      if (parts.length >= 2) {
        const userId = parts[0]
        const timestamp = parts[1]

        // Insert into your Neon Postgres DB
        await client.query(
          'INSERT INTO attendance (user_id, timestamp) VALUES ($1, $2) ON CONFLICT DO NOTHING',
          [userId, timestamp]
        )
      }
    }

    await client.end()
  }

  // ZKTeco devices expect "OK" returned in plain text
  return c.text('OK')
})

export default app