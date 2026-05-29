import fs from 'node:fs'
import path from 'node:path'
import { getSpecialNetflixAction, type SpecialNetflixActionKey } from './codes-telegram-special'

type DirectTelegramPayload = {
  action: SpecialNetflixActionKey
  recipient: string
}

type TelegramContext = {
  botEntity: unknown
  client: any
}

const PROJECT_ROOT = process.cwd()
const DEFAULT_SESSION_FILE = '.telegram-bridge-session'

let telegramContextPromise: Promise<TelegramContext> | null = null
let queueTail = Promise.resolve<unknown>(undefined)

const normalizeText = (value: unknown) => String(value || '').trim()
const readNumberEnv = (name: string, fallback: number) => {
  const value = Number(process.env[name] || '')
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback
}

const normalizeButtonText = (value: unknown) =>
  String(value || '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

const getSessionString = () => {
  const sessionFromEnv = normalizeText(process.env.TELEGRAM_SESSION_STRING)
  if (sessionFromEnv) return sessionFromEnv

  const sessionFile = path.resolve(
    PROJECT_ROOT,
    normalizeText(process.env.TELEGRAM_BRIDGE_SESSION_FILE) || DEFAULT_SESSION_FILE
  )

  if (fs.existsSync(sessionFile)) {
    return fs.readFileSync(sessionFile, 'utf8').trim()
  }

  return ''
}

async function ensureTelegramContext() {
  if (telegramContextPromise) return telegramContextPromise

  telegramContextPromise = (async () => {
    const apiId = readNumberEnv('TELEGRAM_API_ID', 0)
    const apiHash = normalizeText(process.env.TELEGRAM_API_HASH)
    const sessionString = getSessionString()
    const botUsername = normalizeText(process.env.TELEGRAM_BRIDGE_BOT_USERNAME) || '@tutiendastore_bot'

    if (!apiId || !apiHash) {
      throw new Error('Faltan TELEGRAM_API_ID o TELEGRAM_API_HASH.')
    }

    if (!sessionString) {
      throw new Error('Falta TELEGRAM_SESSION_STRING para conectar Telegram directo desde Vercel.')
    }

    const [{ TelegramClient }, { StringSession }] = await Promise.all([
      import('telegram'),
      import('telegram/sessions'),
    ])

    const client = new TelegramClient(new StringSession(sessionString), apiId, apiHash, {
      connectionRetries: 3,
    })

    await client.connect()
    const botEntity = await client.getEntity(botUsername)

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

async function fetchRecentMessages(client: any, botEntity: unknown, limit = 20) {
  const messages = await client.getMessages(botEntity, { limit })
  return Array.from(messages as unknown[]).sort(
    (left: any, right: any) => Number(left.id) - Number(right.id)
  )
}

function findButton(message: any, needles: string[]) {
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

async function waitForButtonMessage(params: {
  actionLabel: string
  botEntity: unknown
  client: any
  minMessageId: number
  needles: string[]
  timeoutMs: number
}) {
  const startedAt = Date.now()
  const pollMs = readNumberEnv('TELEGRAM_BRIDGE_POLL_MS', 250)

  while (Date.now() - startedAt < params.timeoutMs) {
    const messages = await fetchRecentMessages(params.client, params.botEntity, 20)
    const candidate = [...messages]
      .reverse()
      .find((message: any) => Number(message.id) >= params.minMessageId && !message.out && findButton(message, params.needles))

    if (candidate) return candidate

    await delay(pollMs)
  }

  throw new Error(`No aparecio el menu esperado para "${params.actionLabel}".`)
}

function messageToRawText(message: any) {
  const raw = String(message?.message || message?.text || '').trim()
  if (raw) return raw

  const className = message?.className || message?.constructor?.name || 'Message'
  return `[Mensaje sin texto: ${className}]`
}

function messageToIsoString(message: any) {
  if (message?.date instanceof Date) return message.date.toISOString()

  const parsed = new Date(message?.date || Date.now())
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString()
}

function findLatestIncomingMessage(messages: unknown[], minMessageId: number) {
  return [...messages]
    .reverse()
    .find((message: any) => Number(message.id) > minMessageId && !message.out)
}

async function waitForIncomingMessage(params: {
  botEntity: unknown
  client: any
  minMessageId: number
  timeoutMs: number
}) {
  const startedAt = Date.now()
  const pollMs = readNumberEnv('TELEGRAM_BRIDGE_POLL_MS', 250)

  while (Date.now() - startedAt < params.timeoutMs) {
    const messages = await fetchRecentMessages(params.client, params.botEntity, 30)
    const latestIncomingMessage = findLatestIncomingMessage(messages, params.minMessageId)

    if (latestIncomingMessage) return latestIncomingMessage

    await delay(pollMs)
  }

  return null
}

async function maybeResolveResetPasswordLink(params: {
  botEntity: unknown
  client: any
  initialMessage: any
}) {
  const copyLinkButton = findButton(params.initialMessage, ['copiar link', 'copiar el link'])
  if (!copyLinkButton) return params.initialMessage

  await copyLinkButton.click({})
  await delay(readNumberEnv('TELEGRAM_BRIDGE_POST_CLICK_SETTLE_MS', 150))

  const followUpMessage = await waitForIncomingMessage({
    botEntity: params.botEntity,
    client: params.client,
    minMessageId: Number(params.initialMessage.id),
    timeoutMs: readNumberEnv('TELEGRAM_BRIDGE_FOLLOW_UP_TIMEOUT_MS', 10000),
  })

  return followUpMessage || params.initialMessage
}

async function runDirectTelegramFlow(payload: DirectTelegramPayload) {
  const action = getSpecialNetflixAction(payload.action)
  if (!action) {
    throw new Error('La accion pedida no existe en Telegram.')
  }

  const { botEntity, client } = await ensureTelegramContext()
  const menuTimeoutMs = readNumberEnv('TELEGRAM_BRIDGE_MENU_TIMEOUT_MS', 15000)
  const waitMs = readNumberEnv('TELEGRAM_BRIDGE_WAIT_MS', 15000)
  const settleMs = readNumberEnv('TELEGRAM_BRIDGE_POST_CLICK_SETTLE_MS', 150)
  const botUsername = normalizeText(process.env.TELEGRAM_BRIDGE_BOT_USERNAME) || '@tutiendastore_bot'

  const startMessage = await client.sendMessage(botEntity, { message: '/start' })

  const platformMenu = await waitForButtonMessage({
    actionLabel: 'Netflix',
    botEntity,
    client,
    minMessageId: Number((startMessage as any).id),
    needles: ['netflix'],
    timeoutMs: menuTimeoutMs,
  })

  const netflixButton = findButton(platformMenu, ['netflix'])
  if (!netflixButton) {
    throw new Error('No se encontro el boton de Netflix.')
  }

  await netflixButton.click({})
  if (settleMs > 0) await delay(settleMs)

  const actionMenu = await waitForButtonMessage({
    actionLabel: action.label,
    botEntity,
    client,
    minMessageId: Number((platformMenu as any).id),
    needles: action.buttonNeedles,
    timeoutMs: menuTimeoutMs,
  })

  const actionButton = findButton(actionMenu, action.buttonNeedles)
  if (!actionButton) {
    throw new Error(`No se encontro el boton para "${action.label}".`)
  }

  await actionButton.click({})
  if (settleMs > 0) await delay(settleMs)

  const emailMessage = await client.sendMessage(botEntity, { message: payload.recipient })
  const emailMessageId = Number((emailMessage as any).id)

  await delay(waitMs)

  const recentMessages = await fetchRecentMessages(client, botEntity, 30)
  let latestIncomingMessage = findLatestIncomingMessage(recentMessages, emailMessageId)

  if (!latestIncomingMessage) {
    throw new Error(`No hubo un mensaje nuevo del bot despues de esperar ${waitMs / 1000} segundos.`)
  }

  if (payload.action === 'reset-password') {
    latestIncomingMessage = await maybeResolveResetPasswordLink({
      botEntity,
      client,
      initialMessage: latestIncomingMessage,
    })
  }

  return {
    action: payload.action,
    action_label: action.label,
    bot_username: botUsername,
    message: messageToRawText(latestIncomingMessage),
    platform: 'netflix' as const,
    received_at: messageToIsoString(latestIncomingMessage),
    recipient: payload.recipient,
    source_message_id: Number((latestIncomingMessage as any).id),
    wait_ms: waitMs,
  }
}

export function invokeDirectTelegramFlow(payload: DirectTelegramPayload) {
  const job = queueTail.catch(() => undefined).then(() => runDirectTelegramFlow(payload))
  queueTail = job.catch(() => undefined)
  return job
}
