import { stripHtml } from './lemon-parser'
import { type CodePlatformKey } from './codes-shared'

export type SpotinetMessage = {
  uid: number
  subject: string
  from: string
  to: string[]
  date: Date
  bodyText: string
  bodyHtml: string
  messageId: string
  platform: CodePlatformKey
  source: 'spotinet'
  variantLabel: string
}

type SpotinetConfig = {
  backendUrl: string
  baseUrl: string
  email: string
  id: string
  label: string
  maxItems: number
  password: string
}

type SpotinetAction = {
  bodyLabel: string
  key: string
  method: 'GET' | 'POST'
  path: (recipient: string) => string
  responseKey: 'code' | 'link'
  subject: string
  variantLabel: string
}

const DEFAULT_BASE_URL = 'https://www.spotinetshop.com'
const DEFAULT_BACKEND_URL = 'https://spotinet-backend-798163743367.us-central1.run.app'
const DEFAULT_MAX_ITEMS = 4
const DEFAULT_SEARCH_TIMEOUT_MS = 10000
const DEFAULT_RETRY_WAIT_MS = 1500

const SPOTINET_ACTIONS: SpotinetAction[] = [
  {
    bodyLabel: 'Codigo de inicio de sesion',
    key: 'session_code',
    method: 'POST',
    path: () => '/netflix/session_code/',
    responseKey: 'code',
    subject: 'Netflix: Tu codigo de inicio de sesion',
    variantLabel: 'Codigo de inicio de sesion',
  },
  {
    bodyLabel: 'Codigo de verificacion',
    key: 'verification_code',
    method: 'POST',
    path: () => '/netflix/verification_code/',
    responseKey: 'code',
    subject: 'Netflix: Codigo de verificacion',
    variantLabel: 'Codigo de verificacion',
  },
  {
    bodyLabel: 'Restablecer contrasena',
    key: 'password_reset',
    method: 'POST',
    path: () => '/netflix/password_reset/',
    responseKey: 'link',
    subject: 'Netflix: Restablecer contrasena',
    variantLabel: 'Restablecer contrasena',
  },
  {
    bodyLabel: 'Actualizar hogar o acceso temporal de viaje',
    key: 'home_or_temporal',
    method: 'GET',
    path: recipient => `/netflix/home_code_or_temporal_access/${encodeURIComponent(recipient)}`,
    responseKey: 'link',
    subject: 'Netflix: Actualizar hogar o Estoy de viaje',
    variantLabel: 'Actualizar hogar o Estoy de viaje',
  },
]

const normalizeText = (value: string | null | undefined) => (value || '').trim()
const normalizeEmail = (value: string) => normalizeText(value).toLowerCase()
const normalizeBaseUrl = (value: string | null | undefined) => normalizeText(value).replace(/\/+$/, '')
const readString = (value: unknown) =>
  typeof value === 'string' ? value : typeof value === 'number' || typeof value === 'boolean' ? String(value) : ''

const toPositiveInt = (value: string | undefined, fallback: number) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback
}

const sleep = (milliseconds: number) => new Promise(resolve => setTimeout(resolve, milliseconds))

const buildAccountId = (baseUrl: string, email: string) =>
  `${baseUrl.toLowerCase()}|${email.toLowerCase()}`.replace(/[^a-z0-9|._:@/-]+/g, '-')

const buildAccountLabel = (email: string, fallback?: string | null) => {
  const explicit = normalizeText(fallback)
  if (explicit) return explicit
  return email.split('@')[0]?.trim() || email
}

const sanitizeHtml = (html: string) =>
  html
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, '')
    .replace(/\son\w+\s*=\s*(['"]).*?\1/gi, '')
    .replace(/\son\w+\s*=\s*[^ >]+/gi, '')
    .replace(/href\s*=\s*(['"])\s*javascript:[^'"]*\1/gi, 'href="#"')
    .trim()

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')

const isSafeHttpUrl = (value: string) => {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

const isEmptyProviderValue = (value: string) => {
  const normalized = normalizeText(value)
  if (!normalized) return true
  return /no fue solicitado en los ultimos 20 minutos/i.test(
    normalized.normalize('NFD').replace(/[\u0300-\u036f]+/g, '')
  )
}

const hashText = (value: string) => {
  let hash = 0
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0
  }
  return hash || 1
}

const parseJsonConfigs = (): SpotinetConfig[] => {
  const raw = normalizeText(process.env.SPOTINET_ACCOUNTS_JSON)
  if (!raw) return []

  const fallbackBaseUrl = normalizeBaseUrl(process.env.SPOTINET_BASE_URL) || DEFAULT_BASE_URL
  const fallbackBackendUrl = normalizeBaseUrl(process.env.SPOTINET_BACKEND_URL) || DEFAULT_BACKEND_URL
  const fallbackMaxItems = toPositiveInt(process.env.SPOTINET_MAX_ITEMS, DEFAULT_MAX_ITEMS)

  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []

    return parsed
      .map((item, index) => {
        if (!item || typeof item !== 'object') return null
        const record = item as Record<string, unknown>
        const email = normalizeText(readString(record.email) || readString(record.username))
        const password = normalizeText(readString(record.password))
        if (!email || !password) return null

        const baseUrl = normalizeBaseUrl(readString(record.baseUrl)) || fallbackBaseUrl
        const backendUrl = normalizeBaseUrl(readString(record.backendUrl)) || fallbackBackendUrl

        return {
          backendUrl,
          baseUrl,
          email,
          id: normalizeText(readString(record.id)) || buildAccountId(baseUrl, email),
          label: buildAccountLabel(email, readString(record.label) || readString(record.name) || `Spotinet ${index + 1}`),
          maxItems: toPositiveInt(readString(record.maxItems) || String(fallbackMaxItems), fallbackMaxItems),
          password,
        }
      })
      .filter((config): config is SpotinetConfig => Boolean(config))
  } catch {
    return []
  }
}

const parseLegacyConfig = (): SpotinetConfig | null => {
  const email = normalizeText(process.env.SPOTINET_USERNAME)
  const password = normalizeText(process.env.SPOTINET_PASSWORD)
  if (!email || !password) return null

  const baseUrl = normalizeBaseUrl(process.env.SPOTINET_BASE_URL) || DEFAULT_BASE_URL
  return {
    backendUrl: normalizeBaseUrl(process.env.SPOTINET_BACKEND_URL) || DEFAULT_BACKEND_URL,
    baseUrl,
    email,
    id: buildAccountId(baseUrl, email),
    label: buildAccountLabel(email),
    maxItems: toPositiveInt(process.env.SPOTINET_MAX_ITEMS, DEFAULT_MAX_ITEMS),
    password,
  }
}

const getConfig = () => {
  const jsonConfigs = parseJsonConfigs()
  if (jsonConfigs.length > 0) return jsonConfigs

  const legacyConfig = parseLegacyConfig()
  return legacyConfig ? [legacyConfig] : []
}

const getSetCookies = (headers: Headers) => {
  const withGetSetCookie = headers as Headers & { getSetCookie?: () => string[] }
  if (typeof withGetSetCookie.getSetCookie === 'function') {
    return withGetSetCookie.getSetCookie()
  }

  const single = headers.get('set-cookie')
  return single ? [single] : []
}

const cookieHeader = (cookies: string[]) =>
  cookies
    .map(cookie => cookie.split(';')[0]?.trim())
    .filter(Boolean)
    .join('; ')

const login = async (config: SpotinetConfig) => {
  const cookies: string[] = []
  const loginResponse = await fetch(`${config.baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email: config.email,
      password: config.password,
    }),
    cache: 'no-store',
  })

  cookies.push(...getSetCookies(loginResponse.headers))

  if (!loginResponse.ok) {
    throw new Error(`Spotinet devolvio estado ${loginResponse.status} al iniciar sesion.`)
  }

  const accessTokenResponse = await fetch(`${config.baseUrl}/api/auth/access-token`, {
    headers: {
      Accept: 'application/json',
      Cookie: cookieHeader(cookies),
    },
    cache: 'no-store',
  })

  cookies.push(...getSetCookies(accessTokenResponse.headers))

  if (!accessTokenResponse.ok) {
    throw new Error(`Spotinet devolvio estado ${accessTokenResponse.status} al obtener token.`)
  }

  const payload = (await accessTokenResponse.json()) as { access_token?: string }
  const token = normalizeText(payload.access_token)
  if (!token) {
    throw new Error('Spotinet no devolvio un token valido.')
  }

  return token
}

const requestAction = async (params: {
  action: SpotinetAction
  config: SpotinetConfig
  recipient: string
  token: string
}) => {
  const response = await fetch(`${params.config.backendUrl}${params.action.path(params.recipient)}`, {
    method: params.action.method,
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${params.token}`,
      'Content-Type': 'application/json',
    },
    body: params.action.method === 'POST' ? JSON.stringify({ email: params.recipient }) : undefined,
    cache: 'no-store',
  })

  if (!response.ok) {
    throw new Error(`Spotinet devolvio estado ${response.status} en ${params.action.variantLabel}.`)
  }

  return (await response.json()) as Record<string, unknown>
}

const requestActionWithRetry = async (params: {
  action: SpotinetAction
  config: SpotinetConfig
  recipient: string
  token: string
}) => {
  const timeoutMs = toPositiveInt(process.env.SPOTINET_SEARCH_TIMEOUT_MS, DEFAULT_SEARCH_TIMEOUT_MS)
  const waitMs = toPositiveInt(process.env.SPOTINET_RETRY_WAIT_MS, DEFAULT_RETRY_WAIT_MS)
  let lastPayload: Record<string, unknown> = {}
  const deadline = Date.now() + timeoutMs

  while (Date.now() <= deadline) {
    lastPayload = await requestAction(params)
    const rawValue = readString(lastPayload[params.action.responseKey])

    if (!isEmptyProviderValue(rawValue)) {
      return lastPayload
    }

    const remainingMs = deadline - Date.now()
    if (remainingMs <= 0) break
    await sleep(Math.min(waitMs, remainingMs))
  }

  return lastPayload
}

const buildMessage = (params: {
  action: SpotinetAction
  config: SpotinetConfig
  index: number
  recipient: string
  value: string
}): SpotinetMessage | null => {
  const value = normalizeText(params.value)
  if (isEmptyProviderValue(value)) return null

  const isLink = params.action.responseKey === 'link'
  const safeValue = isLink && !isSafeHttpUrl(value) ? '' : value
  if (isLink && !safeValue) return null

  const bodyHtml = isLink
    ? `<p>${escapeHtml(params.action.bodyLabel)}</p><p><a href="${escapeHtml(safeValue)}" target="_blank" rel="noopener noreferrer">${escapeHtml(params.action.bodyLabel)}</a></p>`
    : `<p>${escapeHtml(params.action.bodyLabel)}</p><p><strong>${escapeHtml(value)}</strong></p>`
  const bodyText = isLink ? `${params.action.bodyLabel}: ${safeValue}` : `${params.action.bodyLabel}: ${value}`
  const hash = hashText(`${params.config.id}:${params.action.key}:${params.recipient}:${value}`)

  return {
    uid: hash,
    subject: params.action.subject,
    from: params.config.label,
    to: [params.recipient],
    date: new Date(),
    bodyText,
    bodyHtml: sanitizeHtml(bodyHtml),
    messageId: `spotinet:${params.config.id}:${params.action.key}:${hash}`,
    platform: 'netflix',
    source: 'spotinet',
    variantLabel: `${params.config.label} - ${params.action.variantLabel}`,
  }
}

const fetchConfigMessages = async (config: SpotinetConfig, recipient: string) => {
  const token = await login(config)

  const settled = await Promise.allSettled(
    SPOTINET_ACTIONS.map(async (action, index) => {
      const payload = await requestActionWithRetry({ action, config, recipient, token })
      const rawValue = readString(payload[action.responseKey])
      return buildMessage({
        action,
        config,
        index,
        recipient,
        value: rawValue || stripHtml(JSON.stringify(payload)),
      })
    })
  )

  const messages = settled
    .filter((result): result is PromiseFulfilledResult<SpotinetMessage | null> => result.status === 'fulfilled')
    .map(result => result.value)
    .filter((message): message is SpotinetMessage => Boolean(message))

  return {
    messages: messages.slice(0, config.maxItems),
    totalScanned: SPOTINET_ACTIONS.length,
    variantsScanned: SPOTINET_ACTIONS.map(action => `${config.label} - ${action.variantLabel}`),
  }
}

export const isSpotinetConfigured = () => getConfig().length > 0

export const fetchSpotinetMessages = async (params: {
  platform: CodePlatformKey
  recipient: string
}): Promise<{ messages: SpotinetMessage[]; totalScanned: number; variantsScanned: string[] }> => {
  if (params.platform !== 'netflix') {
    return { messages: [], totalScanned: 0, variantsScanned: [] }
  }

  const configs = getConfig()
  if (configs.length === 0) {
    return { messages: [], totalScanned: 0, variantsScanned: [] }
  }

  const successful: Array<{
    messages: SpotinetMessage[]
    totalScanned: number
    variantsScanned: string[]
  }> = []
  const failed: unknown[] = []
  const recipient = normalizeEmail(params.recipient)

  for (const config of configs) {
    try {
      successful.push(await fetchConfigMessages(config, recipient))
    } catch (error) {
      failed.push(error)
    }
  }

  if (successful.length === 0 && failed.length > 0) {
    const firstError = failed[0]
    throw firstError instanceof Error ? firstError : new Error('Spotinet no pudo cargar ninguna cuenta.')
  }

  return {
    messages: successful.flatMap(result => result.messages),
    totalScanned: successful.reduce((sum, result) => sum + result.totalScanned, 0),
    variantsScanned: Array.from(new Set(successful.flatMap(result => result.variantsScanned).filter(Boolean))),
  }
}
