import { Hono } from 'hono'
import { neon } from '@neondatabase/serverless'

type Bindings = {
  DATABASE_URL: string
}

const app = new Hono<{ Bindings: Bindings }>()

// 1. GET /iclock/cdata - Device handshake configuring Asia/Manila (UTC+8) and forcing log push
app.get('/iclock/cdata', (c) => {
  const sn = c.req.query('SN') || 'unknown'
  console.log(`Device check-in SN=${sn} — requesting full ATTLOG`)
  
  const body = [
    `GET OPTION FROM: ${sn}`,
    'ATTLOGStamp=0',         // Forces device to send all logs including past punches
    'OPERLOGStamp=0',
    'ATTPHOTOStamp=0',
    'ErrorDelay=60',
    'Delay=10',
    'TransTimes=00:00;23:59',
    'TransInterval=1',
    'TransFlag=TransData AttLog\tOpLog',
    'Realtime=1',
    'TimeZone=8',            // Sets device timezone to UTC+8 (Asia/Manila)
    'ServerVer=2.4.1'
  ].join('\n')

  return c.text(body)
})

// 2. GET /iclock/getrequest - Device command polling endpoint
app.get('/iclock/getrequest', (c) => {
  return c.text('OK')
})

// 3. POST /iclock/devicecmd - Device command acknowledgment endpoint
app.post('/iclock/devicecmd', (c) => {
  return c.text('OK')
})

// 4. POST /iclock/cdata - Receives attendance logs from the device
app.post('/iclock/cdata', async (c) => {
  const table = c.req.query('table') || ''
  const sn = c.req.query('SN') || 'unknown'
  const postData = await c.req.text()

  if (table === 'ATTLOG' || (!table && postData.trim())) {
    const records = parseAttendance(postData)
    console.log(`ATTLOG from ${sn}: ${records.length} record(s)`)

    if (records.length > 0) {
      // Safely fetch DATABASE_URL binding inside request context
      const dbUrl = c.env.DATABASE_URL
      
      if (!dbUrl) {
        console.error('DATABASE_URL variable is not bound to Cloudflare Worker!')
        return c.text('OK')
      }

      // Initialize neon HTTP client (works natively on Cloudflare Workers edge)
      const sql = neon(dbUrl)

      try {
        let insertedCount = 0
        for (const [userId, timestamp] of records) {
          // Format timestamp for Asia/Manila (+08:00)
          const tsWithTz = `${timestamp}+08:00`
          
          await sql`
            INSERT INTO attendance (user_id, timestamp)
            VALUES (${userId}, ${tsWithTz}::timestamptz)
            ON CONFLICT DO NOTHING
          `
          insertedCount++
        }
        console.log(`Successfully saved ${insertedCount} record(s) to Neon.`)
      } catch (e) {
        console.error('Database error during insert:', e)
      }
    }
  } else {
    console.log(`${table || 'unknown'} from ${sn} (ignored)`)
  }

  return c.text('OK')
})

// Helper function to parse ZKTeco tab-delimited log lines
function parseAttendance(body: string): [string, string][] {
  const records: [string, string][] = []
  const lines = body.split(/\r?\n/)
  for (let line of lines) {
    line = line.trim()
    if (!line) continue
    const parts = line.split('\t')
    if (parts.length >= 2) {
      const userId = parts[0]
      const timestamp = parts[1]
      if (timestamp.includes('-') && timestamp.includes(':')) {
        records.push([userId, timestamp])
      }
    }
  }
  return records
}

export default app