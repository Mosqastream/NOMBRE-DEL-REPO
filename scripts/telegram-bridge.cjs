/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs')
const http = require('node:http')
const path = require('node:path')
const readline = require('node:readline/promises')
const { stdin, stdout } = require('node:process')
const { TelegramClient } = require('telegram')
const { StringSession } = require('telegram/sessions')

const PROJECT_ROOT = path.resolve(__dirname, '..')

loadLocalEnv()

const ACTIONS = {
  'access-temporary-link': {
    buttonNeedles: ['link acceso temporal'],
    label: 'Link Acceso Temporal',
  },
  'login-code': {
    buttonNeedles: ['cod. inicio sesion', 'cod inicio sesion'],
    label: 'Cod. Inicio Sesion',
  },
  'verification-code': {
    buttonNeedles: ['cod. verificacion', 'cod verificacion', 'codigo de verificacion'],
    label: 'Cod. Verificacion',
  },
  'reset-password': {
    buttonNeedles: ['reset password'],
    label: 'Reset Password',
  },
  'update-household-link': {
    buttonNeedles: ['link actualizar hogar'],
    label: 'Link Actualizar Hogar',
  },
}

const HOST = readTextEnv('TELEGRAM_BRIDGE_HOST') || '127.0.0.1'
const PORT = readNumberEnv('TELEGRAM_BRIDGE_PORT', 8787)
const API_ID = readNumberEnv('TELEGRAM_API_ID', 0)
const API_HASH = readTextEnv('TELEGRAM_API_HASH')
const BOT_USERNAME = readTextEnv('TELEGRAM_BRIDGE_BOT_USERNAME') || '@tutiendastore_bot'
const SHARED_SECRET = readTextEnv('CODES_TELEGRAM_BRIDGE_SECRET')
const WAIT_MS = readNumberEnv('TELEGRAM_BRIDGE_WAIT_MS', 15000)
const MENU_TIMEOUT_MS = readNumberEnv('TELEGRAM_BRIDGE_MENU_TIMEOUT_MS', 15000)
const POLL_MS = readNumberEnv('TELEGRAM_BRIDGE_POLL_MS', 250)
const POST_CLICK_SETTLE_MS = readNumberEnv('TELEGRAM_BRIDGE_POST_CLICK_SETTLE_MS', 150)
const FOLLOW_UP_TIMEOUT_MS = readNumberEnv('TELEGRAM_BRIDGE_FOLLOW_UP_TIMEOUT_MS', 10000)
const SESSION_FILE = path.resolve(
  PROJECT_ROOT,
  readTextEnv('TELEGRAM_BRIDGE_SESSION_FILE') || '.telegram-bridge-session'
)

let telegramContextPromise = null
let queueTail = Promise.resolve()

function loadLocalEnv() {
  const candidates = ['.env.local', '.env'].map(file => path.resolve(PROJECT_ROOT, file))

  for (const filePath of candidates) {
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

function readTextEnv(name) {
  return (process.env[name] || '').trim()
}

function readNumberEnv(name, fallback) {
  const value = Number(process.env[name] || '')
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback
}

function normalizeButtonText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function prompt(question) {
  const rl = readline.createInterface({ input: stdin, output: stdout })
  try {
    return (await rl.question(question)).trim()
  } finally {
    rl.close()
  }
}

function requireBridgeConfig() {
  if (!API_ID || !API_HASH) {
    throw new Error(
      'Faltan TELEGRAM_API_ID o TELEGRAM_API_HASH. Crea tu app en https://my.telegram.org/apps y guardalos en .env.local.'
    )
  }

  if (!SHARED_SECRET) {
    throw new Error('Falta CODES_TELEGRAM_BRIDGE_SECRET en .env.local.')
  }
}

async function ensureTelegramContext() {
  if (telegramContextPromise) {
    return telegramContextPromise
  }

  telegramContextPromise = (async () => {
    requireBridgeConfig()

    const savedSession = fs.existsSync(SESSION_FILE) ? fs.readFileSync(SESSION_FILE, 'utf8').trim() : ''
    const client = new TelegramClient(new StringSession(savedSession), API_ID, API_HASH, {
      connectionRetries: 5,
    })

    if (typeof client.setLogLevel === 'function') {
      client.setLogLevel('error')
    }

    await client.start({
      phoneNumber: async () => prompt('Numero de la cuenta secundaria (+51...): '),
      password: async () => prompt('Password 2FA (si no tienes, Enter): '),
      phoneCode: async () => prompt('Codigo que te llega a Telegram: '),
      onError: error => {
        console.error('[telegram-bridge] auth error:', error)
      },
    })

    const sessionString = client.session.save()
    fs.writeFileSync(SESSION_FILE, sessionString, 'utf8')

    const botEntity = await client.getEntity(BOT_USERNAME)

    console.log('[telegram-bridge] Sesion lista.')
    console.log(`[telegram-bridge] Bot objetivo: ${BOT_USERNAME}`)
    console.log(`[telegram-bridge] Session guardada en: ${SESSION_FILE}`)

    return {
      botEntity,
      client,
    }
  })().catch(error => {
    telegramContextPromise = null
    throw error
  })

  return telegramContextPromise
}

async function fetchRecentMessages(client, botEntity, limit = 20) {
  const messages = await client.getMessages(botEntity, { limit })
  return Array.from(messages).sort((left, right) => Number(left.id) - Number(right.id))
}

function findButton(message, needles) {
  const normalizedNeedles = needles.map(needle => normalizeButtonText(needle))
  const rows = Array.isArray(message?.buttons) ? message.buttons : []

  for (const row of rows) {
    for (const button of row) {
      const buttonText = normalizeButtonText(button?.text || '')
      if (!buttonText) continue

      if (normalizedNeedles.some(needle => buttonText.includes(needle))) {
        return button
      }
    }
  }

  return null
}

async function waitForButtonMessage(params) {
  const { actionLabel, botEntity, client, minMessageId, needles, timeoutMs } = params
  const startedAt = Date.now()

  while (Date.now() - startedAt < timeoutMs) {
    const messages = await fetchRecentMessages(client, botEntity, 20)
    const candidate = [...messages]
      .reverse()
      .find(message => Number(message.id) >= minMessageId && !message.out && findButton(message, needles))

    if (candidate) {
      return candidate
    }

    await delay(POLL_MS)
  }

  throw new Error(`No aparecio el menu esperado para "${actionLabel}".`)
}

function messageToRawText(message) {
  const raw = String(message?.message || message?.text || '').trim()
  if (raw) return raw

  const className = message?.className || message?.constructor?.name || 'Message'
  return `[Mensaje sin texto: ${className}]`
}

function isProgressMessage(message) {
  const normalized = messageToRawText(message)
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()

  return (
    normalized.includes('buscando en la bandeja') ||
    normalized.includes('por favor espera') ||
    normalized.includes('espera un momento')
  )
}

function messageToIsoString(message) {
  if (message?.date instanceof Date) {
    return message.date.toISOString()
  }

  const parsed = new Date(message?.date || Date.now())
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString()
}

function findLatestIncomingMessage(messages, minMessageId) {
  return [...messages]
    .reverse()
    .find(message => Number(message.id) > minMessageId && !message.out && !isProgressMessage(message))
}

async function waitForIncomingMessage(params) {
  const { botEntity, client, minMessageId, timeoutMs } = params
  const startedAt = Date.now()

  while (Date.now() - startedAt < timeoutMs) {
    const messages = await fetchRecentMessages(client, botEntity, 30)
    const latestIncomingMessage = findLatestIncomingMessage(messages, minMessageId)

    if (latestIncomingMessage) {
      return latestIncomingMessage
    }

    await delay(POLL_MS)
  }

  return null
}

async function maybeResolveCopyLinkMessage(params) {
  const { botEntity, client, initialMessage } = params
  const copyLinkButton = findButton(initialMessage, ['copiar link', 'copiar el link', 'copiar'])

  if (!copyLinkButton) {
    return initialMessage
  }

  await copyLinkButton.click({})
  if (POST_CLICK_SETTLE_MS > 0) {
    await delay(POST_CLICK_SETTLE_MS)
  }

  const followUpMessage = await waitForIncomingMessage({
    botEntity,
    client,
    minMessageId: Number(initialMessage.id),
    timeoutMs: FOLLOW_UP_TIMEOUT_MS,
  })

  return followUpMessage || initialMessage
}

async function runTelegramFlow(payload) {
  const action = ACTIONS[payload.action]
  if (!action) {
    throw new Error('La accion pedida no existe en el bridge.')
  }

  const { botEntity, client } = await ensureTelegramContext()

  console.log(`[telegram-bridge] Nueva solicitud: ${payload.recipient} -> ${action.label}`)

  const startMessage = await client.sendMessage(botEntity, { message: '/start' })

  const platformMenu = await waitForButtonMessage({
    actionLabel: 'Netflix',
    botEntity,
    client,
    minMessageId: Number(startMessage.id),
    needles: ['netflix'],
    timeoutMs: MENU_TIMEOUT_MS,
  })

  const netflixButton = findButton(platformMenu, ['netflix'])
  if (!netflixButton) {
    throw new Error('No se encontro el boton de Netflix.')
  }
  await netflixButton.click({})
  if (POST_CLICK_SETTLE_MS > 0) {
    await delay(POST_CLICK_SETTLE_MS)
  }

  const actionMenu = await waitForButtonMessage({
    actionLabel: action.label,
    botEntity,
    client,
    minMessageId: Number(platformMenu.id),
    needles: action.buttonNeedles,
    timeoutMs: MENU_TIMEOUT_MS,
  })

  const actionButton = findButton(actionMenu, action.buttonNeedles)
  if (!actionButton) {
    throw new Error(`No se encontro el boton para "${action.label}".`)
  }
  await actionButton.click({})
  if (POST_CLICK_SETTLE_MS > 0) {
    await delay(POST_CLICK_SETTLE_MS)
  }

  const emailMessage = await client.sendMessage(botEntity, { message: payload.recipient })
  const emailMessageId = Number(emailMessage.id)

  let latestIncomingMessage = await waitForIncomingMessage({
    botEntity,
    client,
    minMessageId: emailMessageId,
    timeoutMs: WAIT_MS,
  })

  if (!latestIncomingMessage) {
    throw new Error(`No hubo un mensaje nuevo del bot despues de esperar ${WAIT_MS / 1000} segundos.`)
  }

  latestIncomingMessage = await maybeResolveCopyLinkMessage({
    botEntity,
    client,
    initialMessage: latestIncomingMessage,
  })

  return {
    action: payload.action,
    action_label: action.label,
    bot_username: BOT_USERNAME,
    message: messageToRawText(latestIncomingMessage),
    platform: 'netflix',
    received_at: messageToIsoString(latestIncomingMessage),
    recipient: payload.recipient,
    source_message_id: Number(latestIncomingMessage.id),
    wait_ms: WAIT_MS,
  }
}

function enqueueInvocation(payload) {
  const job = queueTail.catch(() => undefined).then(() => runTelegramFlow(payload))
  queueTail = job.catch(() => undefined)
  return job
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
  })
  response.end(JSON.stringify(payload))
}

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = []

    request.on('data', chunk => {
      chunks.push(Buffer.from(chunk))
      const totalLength = chunks.reduce((sum, item) => sum + item.length, 0)
      if (totalLength > 64 * 1024) {
        reject(new Error('El body excede el tamano permitido.'))
      }
    })

    request.on('end', () => {
      resolve(Buffer.concat(chunks).toString('utf8'))
    })

    request.on('error', reject)
  })
}

async function handleInvoke(request, response) {
  if (request.headers.authorization !== `Bearer ${SHARED_SECRET}`) {
    sendJson(response, 401, { error: 'No autorizado.' })
    return
  }

  const rawBody = await readRequestBody(request)
  const body = rawBody ? JSON.parse(rawBody) : {}
  const recipient = String(body?.recipient || '').trim().toLowerCase()
  const action = String(body?.action || '').trim()
  const platform = String(body?.platform || '').trim().toLowerCase()

  if (platform !== 'netflix') {
    sendJson(response, 400, { error: 'Solo Netflix esta habilitado en este bridge.' })
    return
  }

  if (!recipient || !recipient.includes('@')) {
    sendJson(response, 400, { error: 'Recipient invalido.' })
    return
  }

  if (!ACTIONS[action]) {
    sendJson(response, 400, { error: 'La accion solicitada no existe.' })
    return
  }

  try {
    const result = await enqueueInvocation({
      action,
      recipient,
    })
    sendJson(response, 200, result)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'No se pudo completar la automatizacion.'
    console.error('[telegram-bridge] flow error:', error)
    sendJson(response, 500, { error: message })
  }
}

async function requestListener(request, response) {
  try {
    if (!request.url) {
      sendJson(response, 404, { error: 'Ruta invalida.' })
      return
    }

    const url = new URL(request.url, `http://${request.headers.host || `${HOST}:${PORT}`}`)

    if (request.method === 'GET' && url.pathname === '/health') {
      sendJson(response, 200, {
        bot_username: BOT_USERNAME,
        ok: true,
        port: PORT,
        session_file: SESSION_FILE,
        wait_ms: WAIT_MS,
      })
      return
    }

    if (request.method === 'POST' && url.pathname === '/invoke') {
      await handleInvoke(request, response)
      return
    }

    sendJson(response, 404, { error: 'Ruta no encontrada.' })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Error interno del bridge.'
    console.error('[telegram-bridge] request error:', error)
    sendJson(response, 500, { error: message })
  }
}

async function main() {
  requireBridgeConfig()
  await ensureTelegramContext()

  const server = http.createServer((request, response) => {
    void requestListener(request, response)
  })

  server.listen(PORT, HOST, () => {
    console.log(`[telegram-bridge] Escuchando en http://${HOST}:${PORT}`)
    console.log('[telegram-bridge] Health: /health')
    console.log('[telegram-bridge] Invoke: POST /invoke')
  })
}

void main().catch(error => {
  console.error('[telegram-bridge] fatal error:', error)
  process.exitCode = 1
})
