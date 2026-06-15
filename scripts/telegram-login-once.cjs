const fs = require('node:fs')
const path = require('node:path')
const readline = require('node:readline/promises')
const { stdin, stdout } = require('node:process')
const { TelegramClient } = require('telegram')
const { StringSession } = require('telegram/sessions')

const PROJECT_ROOT = path.resolve(__dirname, '..')
const SESSION_FILE = path.resolve(PROJECT_ROOT, process.env.TELEGRAM_BRIDGE_SESSION_FILE || '.telegram-bridge-session')

loadLocalEnv()

function loadLocalEnv() {
  for (const fileName of ['.env.local', '.env.vercel.production.local', '.env.production.local', '.env']) {
    const filePath = path.resolve(PROJECT_ROOT, fileName)
    if (!fs.existsSync(filePath)) continue

    const content = fs.readFileSync(filePath, 'utf8')
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const separatorIndex = trimmed.indexOf('=')
      if (separatorIndex <= 0) continue

      const key = trimmed.slice(0, separatorIndex).trim()
      if (!key || process.env[key] !== undefined) continue

      let value = trimmed.slice(separatorIndex + 1).trim()
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1)
      }
      process.env[key] = value
    }
  }
}

async function prompt(question) {
  const rl = readline.createInterface({ input: stdin, output: stdout })
  try {
    return (await rl.question(question)).trim()
  } finally {
    rl.close()
  }
}

async function main() {
  const apiId = Number(process.env.TELEGRAM_API_ID || '')
  const apiHash = String(process.env.TELEGRAM_API_HASH || '').trim()
  const phone = String(process.argv[2] || process.env.TELEGRAM_LOGIN_PHONE || '').trim()

  if (!apiId || !apiHash) {
    throw new Error('Faltan TELEGRAM_API_ID o TELEGRAM_API_HASH en .env.local.')
  }

  if (!phone) {
    throw new Error('Falta el numero. Ejemplo: node scripts/telegram-login-once.cjs +51929436705')
  }

  const client = new TelegramClient(new StringSession(''), apiId, apiHash, {
    connectionRetries: 5,
  })

  await client.start({
    phoneNumber: async () => phone,
    password: async () => prompt('Password 2FA si tienes, si no Enter: '),
    phoneCode: async () => prompt('Codigo que llego a Telegram: '),
    onError: error => console.error('[telegram-login] auth error:', error),
  })

  const sessionString = client.session.save()
  fs.writeFileSync(SESSION_FILE, sessionString, 'utf8')
  await client.disconnect()

  console.log('')
  console.log(`[telegram-login] Sesion nueva guardada en ${SESSION_FILE}`)
}

void main().catch(error => {
  console.error('[telegram-login] fatal:', error)
  process.exitCode = 1
})
