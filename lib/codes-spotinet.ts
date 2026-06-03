import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
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
  pagePath: string
  path: (recipient: string) => string
  responseKey: 'code' | 'link'
  subject: string
  variantLabel: string
}

const DEFAULT_BASE_URL = 'https://www.spotinetshop.com'
const DEFAULT_BACKEND_URL = 'https://spotinet-backend-798163743367.us-central1.run.app'
const DEFAULT_MAX_ITEMS = 4
const DEFAULT_SEARCH_TIMEOUT_MS = 55000
const DEFAULT_ACTION_TIMEOUT_MS = 20000
const DEFAULT_RETRY_WAIT_MS = 1500
const SPOTINET_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36'

const SPOTINET_ACTIONS: SpotinetAction[] = [
  {
    bodyLabel: 'Codigo de inicio de sesion',
    key: 'session_code',
    method: 'POST',
    pagePath: '/session_netflix_code',
    path: () => '/netflix/session_code/',
    responseKey: 'code',
    subject: 'Netflix: Tu codigo de inicio de sesion',
    variantLabel: 'Codigo de inicio de sesion',
  },
  {
    bodyLabel: 'Codigo de verificacion',
    key: 'verification_code',
    method: 'POST',
    pagePath: '/netflix_verification_code',
    path: () => '/netflix/verification_code/',
    responseKey: 'code',
    subject: 'Netflix: Codigo de verificacion',
    variantLabel: 'Codigo de verificacion',
  },
  {
    bodyLabel: 'Restablecer contrasena',
    key: 'password_reset',
    method: 'POST',
    pagePath: '/password_reset',
    path: () => '/netflix/password_reset/',
    responseKey: 'link',
    subject: 'Netflix: Restablecer contrasena',
    variantLabel: 'Restablecer contrasena',
  },
  {
    bodyLabel: 'Actualizar hogar o acceso temporal de viaje',
    key: 'home_or_temporal',
    method: 'GET',
    pagePath: '/home_or_temporal',
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

const requestJsonWithNode = async (params: {
  body?: string
  headers: Record<string, string>
  method: 'GET' | 'POST'
  signal?: AbortSignal
  url: string
}) =>
  new Promise<Record<string, unknown>>((resolve, reject) => {
    const url = new URL(params.url)
    const body = params.body || ''
    const requestFn = url.protocol === 'http:' ? httpRequest : httpsRequest
    const headers = {
      ...params.headers,
      ...(body ? { 'Content-Length': String(Buffer.byteLength(body)) } : {}),
    }

    const request = requestFn(
      url,
      {
        family: 4,
        headers,
        method: params.method,
      },
      response => {
        const chunks: Buffer[] = []

        response.on('data', chunk => {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
        })

        response.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8')
          if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
            reject(new Error(`Spotinet devolvio estado ${response.statusCode || 0}.`))
            return
          }

          try {
            resolve(raw ? (JSON.parse(raw) as Record<string, unknown>) : {})
          } catch {
            resolve({ raw })
          }
        })
      }
    )

    const abort = () => {
      request.destroy(new Error('This operation was aborted'))
    }

    if (params.signal) {
      if (params.signal.aborted) {
        abort()
        return
      }

      params.signal.addEventListener('abort', abort, { once: true })
      request.on('close', () => params.signal?.removeEventListener('abort', abort))
    }

    request.on('error', reject)
    if (body) request.write(body)
    request.end()
  })

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
  signal?: AbortSignal
  token: string
}) => {
  const payload = params.action.method === 'POST' ? JSON.stringify({ email: params.recipient }) : undefined

  return requestJsonWithNode({
    body: payload,
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${params.token}`,
      'Content-Type': 'application/json',
      Origin: params.config.baseUrl,
      Referer: `${params.config.baseUrl}${params.action.pagePath}`,
      'User-Agent': SPOTINET_USER_AGENT,
    },
    method: params.action.method,
    signal: params.signal,
    url: `${params.config.backendUrl}${params.action.path(params.recipient)}`,
  })
}

const requestActionWithinWindow = async (params: {
  action: SpotinetAction
  config: SpotinetConfig
  deadline: number
  recipient: string
  token: string
}) => {
  const remainingMs = params.deadline - Date.now()
  if (remainingMs <= 0) return {}

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), Math.min(remainingMs, DEFAULT_ACTION_TIMEOUT_MS))

  try {
    return await requestAction({
      action: params.action,
      config: params.config,
      recipient: params.recipient,
      signal: controller.signal,
      token: params.token,
    })
  } finally {
    clearTimeout(timeoutId)
  }
}

const requestActionsUntilFound = async (params: {
  config: SpotinetConfig
  recipient: string
  token: string
}) => {
  const deadline = Date.now() + DEFAULT_SEARCH_TIMEOUT_MS
  let found = false

  const settled = await Promise.allSettled(
    SPOTINET_ACTIONS.map(async (action, index) => {
      let lastError: unknown = null

      while (Date.now() < deadline && !found) {
        try {
          const payload = await requestActionWithinWindow({
            action,
            config: params.config,
            deadline,
            recipient: params.recipient,
            token: params.token,
          })
          const rawValue = readString(payload[action.responseKey])
          const message = buildMessage({
            action,
            config: params.config,
            index,
            recipient: params.recipient,
            value: rawValue || stripHtml(JSON.stringify(payload)),
          })

          if (message) {
            found = true
            return message
          }
        } catch (error) {
          lastError = error
        }

        const remainingMs = deadline - Date.now()
        if (remainingMs <= 0 || found) break
        await sleep(Math.min(DEFAULT_RETRY_WAIT_MS, remainingMs))
      }

      if (lastError) throw lastError
      return null
    })
  )

  const messages = settled
    .filter((result): result is PromiseFulfilledResult<SpotinetMessage | null> => result.status === 'fulfilled')
    .map(result => result.value)
    .filter((message): message is SpotinetMessage => Boolean(message))

  const failed = settled.filter((result): result is PromiseRejectedResult => result.status === 'rejected')

  if (messages.length === 0 && failed.length === settled.length) {
    const firstError = failed[0].reason
    throw firstError instanceof Error ? firstError : new Error('Spotinet no pudo completar la busqueda.')
  }

  return messages
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
  const messages = await requestActionsUntilFound({ config, recipient, token })

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

  const recipient = normalizeEmail(params.recipient)

  const settled = await Promise.allSettled(configs.map(config => fetchConfigMessages(config, recipient)))
  const successful = settled
    .filter(
      (result): result is PromiseFulfilledResult<{
        messages: SpotinetMessage[]
        totalScanned: number
        variantsScanned: string[]
      }> => result.status === 'fulfilled'
    )
    .map(result => result.value)
  const failed = settled.filter((result): result is PromiseRejectedResult => result.status === 'rejected')

  if (successful.length === 0 && failed.length > 0) {
    const firstError = failed[0].reason
    throw firstError instanceof Error ? firstError : new Error('Spotinet no pudo cargar ninguna cuenta.')
  }

  return {
    messages: successful.flatMap(result => result.messages),
    totalScanned: successful.reduce((sum, result) => sum + result.totalScanned, 0),
    variantsScanned: Array.from(new Set(successful.flatMap(result => result.variantsScanned).filter(Boolean))),
  }
}
