import { type CodePlatformKey } from './codes-shared'

export type CodeflixMessage = {
  uid: number
  subject: string
  from: string
  to: string[]
  date: Date
  bodyText: string
  bodyHtml: string
  messageId: string
  platform: 'netflix'
  source: 'codeflix'
  variantLabel: string
}

type CodeflixConfig = {
  baseUrl: string
  id: string
  label: string
  maxItems: number
  password: string
  role: string
  username: string
}

type CodeflixSearchType = 'any' | 'hogar' | 'password' | 'signin' | 'travel' | 'verifica'

type CodeflixSearchResponse = {
  code?: unknown
  error?: unknown
  found?: unknown
  received_at?: unknown
  type?: unknown
}

const DEFAULT_BASE_URL = 'https://codeflix.cc'
const DEFAULT_MAX_ITEMS = 6
const CODEFLIX_TYPES: CodeflixSearchType[] = ['signin', 'hogar', 'password', 'travel', 'verifica', 'any']

const TYPE_META: Record<CodeflixSearchType, { bodyLabel: string; subject: string; variantLabel: string }> = {
  signin: {
    bodyLabel: 'Codigo de inicio de sesion',
    subject: 'Netflix: Tu codigo de inicio de sesion',
    variantLabel: 'Codigo de inicio',
  },
  hogar: {
    bodyLabel: 'Actualizar hogar',
    subject: 'Netflix: Actualizar hogar',
    variantLabel: 'Actualizar hogar',
  },
  password: {
    bodyLabel: 'Restablecer contrasena',
    subject: 'Netflix: Restablecer contrasena',
    variantLabel: 'Actualizar contrasena',
  },
  travel: {
    bodyLabel: 'Acceso temporal durante viajes',
    subject: 'Netflix: Codigo de acceso temporal',
    variantLabel: 'Estoy de viaje',
  },
  verifica: {
    bodyLabel: 'Verifica acceso',
    subject: 'Netflix: Verifica acceso',
    variantLabel: 'Verifica acceso',
  },
  any: {
    bodyLabel: 'Codigo o enlace mas reciente',
    subject: 'Netflix: Codigo o enlace mas reciente',
    variantLabel: 'Cualquiera',
  },
}

const normalizeText = (value: string | null | undefined) => (value || '').trim()
const normalizeEmail = (value: string) => normalizeText(value).toLowerCase()
const normalizeBaseUrl = (value: string | null | undefined) => normalizeText(value).replace(/\/+$/, '')
const readString = (value: unknown) =>
  typeof value === 'string' ? value : typeof value === 'number' || typeof value === 'boolean' ? String(value) : ''

const toPositiveInt = (value: string | undefined, fallback: number) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback
}

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

const hashText = (value: string) => {
  let hash = 0
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0
  }
  return hash || 1
}

const buildAccountId = (baseUrl: string, username: string) =>
  `${baseUrl.toLowerCase()}|${username.toLowerCase()}`.replace(/[^a-z0-9|._:@/-]+/g, '-')

const buildAccountLabel = (username: string, fallback?: string | null) =>
  normalizeText(fallback) || username || 'Codeflix'

const parseJsonConfigs = (): CodeflixConfig[] => {
  const raw = normalizeText(process.env.CODEFLIX_ACCOUNTS_JSON)
  if (!raw) return []

  const fallbackBaseUrl = normalizeBaseUrl(process.env.CODEFLIX_BASE_URL) || DEFAULT_BASE_URL
  const fallbackMaxItems = toPositiveInt(process.env.CODEFLIX_MAX_ITEMS, DEFAULT_MAX_ITEMS)

  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []

    return parsed
      .map((item, index) => {
        if (!item || typeof item !== 'object') return null
        const record = item as Record<string, unknown>
        const username = normalizeText(readString(record.username) || readString(record.user) || readString(record.email))
        const password = normalizeText(readString(record.password))
        if (!username || !password) return null

        const baseUrl = normalizeBaseUrl(readString(record.baseUrl)) || fallbackBaseUrl
        return {
          baseUrl,
          id: normalizeText(readString(record.id)) || buildAccountId(baseUrl, username),
          label: buildAccountLabel(username, readString(record.label) || readString(record.name) || `Codeflix ${index + 1}`),
          maxItems: toPositiveInt(readString(record.maxItems) || String(fallbackMaxItems), fallbackMaxItems),
          password,
          role: normalizeText(readString(record.role)) || 'reseller',
          username,
        }
      })
      .filter((config): config is CodeflixConfig => Boolean(config))
  } catch {
    return []
  }
}

const parseLegacyConfig = (): CodeflixConfig | null => {
  const username = normalizeText(process.env.CODEFLIX_USERNAME)
  const password = normalizeText(process.env.CODEFLIX_PASSWORD)
  if (!username || !password) return null

  const baseUrl = normalizeBaseUrl(process.env.CODEFLIX_BASE_URL) || DEFAULT_BASE_URL
  return {
    baseUrl,
    id: buildAccountId(baseUrl, username),
    label: buildAccountLabel(username),
    maxItems: toPositiveInt(process.env.CODEFLIX_MAX_ITEMS, DEFAULT_MAX_ITEMS),
    password,
    role: normalizeText(process.env.CODEFLIX_ROLE) || 'reseller',
    username,
  }
}

const getConfigs = () => {
  const configs = parseJsonConfigs()
  if (configs.length > 0) return configs

  const legacy = parseLegacyConfig()
  return legacy ? [legacy] : []
}

const login = async (config: CodeflixConfig) => {
  const response = await fetch(`${config.baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      username: config.username,
      password: config.password,
      role: config.role,
    }),
    cache: 'no-store',
  })

  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>
  if (!response.ok) {
    throw new Error(readString(payload.error) || `Codeflix devolvio estado ${response.status} al iniciar sesion.`)
  }

  const token = normalizeText(readString(payload.token))
  if (!token) throw new Error('Codeflix no devolvio un token valido.')
  return token
}

const inferType = (requestedType: CodeflixSearchType, value: string): CodeflixSearchType => {
  if (requestedType !== 'any') return requestedType
  if (/netflix\.com\/password/i.test(value)) return 'password'
  if (/household|hogar/i.test(value)) return 'hogar'
  if (/travel|temporary|temporal|viaje/i.test(value)) return 'travel'
  if (/^\d{4,8}$/.test(value)) return 'signin'
  return 'any'
}

const buildMessage = (params: {
  config: CodeflixConfig
  recipient: string
  requestedType: CodeflixSearchType
  response: CodeflixSearchResponse
}): CodeflixMessage | null => {
  if (params.response.found !== true) return null

  const value = normalizeText(readString(params.response.code))
  if (!value) return null

  const resolvedType = inferType(params.requestedType, value)
  const meta = TYPE_META[resolvedType]
  const isLink = isSafeHttpUrl(value)
  const dateValue = normalizeText(readString(params.response.received_at))
  const parsedDate = dateValue ? new Date(dateValue) : new Date()
  const date = Number.isNaN(parsedDate.getTime()) ? new Date() : parsedDate
  const hash = hashText(`${params.config.id}:${params.recipient}:${value}:${date.toISOString()}`)
  const bodyText = isLink ? `${meta.bodyLabel}: ${value}` : `${meta.bodyLabel}: ${value}`
  const bodyHtml = isLink
    ? `<p>${escapeHtml(meta.bodyLabel)}</p><p><a href="${escapeHtml(value)}" target="_blank" rel="noopener noreferrer">${escapeHtml(meta.bodyLabel)}</a></p>`
    : `<p>${escapeHtml(meta.bodyLabel)}</p><p><strong>${escapeHtml(value)}</strong></p>`

  return {
    uid: hash,
    subject: meta.subject,
    from: params.config.label,
    to: [params.recipient],
    date,
    bodyText,
    bodyHtml,
    messageId: `codeflix:${hash}`,
    platform: 'netflix',
    source: 'codeflix',
    variantLabel: `${params.config.label} - ${meta.variantLabel}`,
  }
}

const searchType = async (params: {
  config: CodeflixConfig
  recipient: string
  token: string
  type: CodeflixSearchType
}) => {
  const response = await fetch(`${params.config.baseUrl}/api/reseller/search-code`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${params.token}`,
      'Cache-Control': 'no-cache',
      'Content-Type': 'application/json',
      Pragma: 'no-cache',
    },
    body: JSON.stringify({
      email: params.recipient,
      type: params.type,
    }),
    cache: 'no-store',
  })

  const payload = (await response.json().catch(() => ({}))) as CodeflixSearchResponse
  if (!response.ok) {
    throw new Error(readString(payload.error) || `Codeflix devolvio estado ${response.status} al buscar.`)
  }

  return buildMessage({
    config: params.config,
    recipient: params.recipient,
    requestedType: params.type,
    response: payload,
  })
}

const fetchConfigMessages = async (config: CodeflixConfig, recipient: string) => {
  const token = await login(config)
  const settled = await Promise.allSettled(
    CODEFLIX_TYPES.map(type => searchType({ config, recipient, token, type }))
  )
  const messages = settled
    .filter((result): result is PromiseFulfilledResult<CodeflixMessage | null> => result.status === 'fulfilled')
    .map(result => result.value)
    .filter((message): message is CodeflixMessage => Boolean(message))

  const deduped = Array.from(new Map(messages.map(message => [message.messageId, message])).values())
  return {
    messages: deduped.slice(0, config.maxItems),
    totalScanned: CODEFLIX_TYPES.length,
    variantsScanned: CODEFLIX_TYPES.map(type => `${config.label} - ${TYPE_META[type].variantLabel}`),
  }
}

export const isCodeflixConfigured = () => getConfigs().length > 0

export const fetchCodeflixMessages = async (params: {
  platform: CodePlatformKey
  recipient: string
}): Promise<{ messages: CodeflixMessage[]; totalScanned: number; variantsScanned: string[] }> => {
  if (params.platform !== 'netflix') return { messages: [], totalScanned: 0, variantsScanned: [] }

  const configs = getConfigs()
  if (configs.length === 0) return { messages: [], totalScanned: 0, variantsScanned: [] }

  const recipient = normalizeEmail(params.recipient)
  const settled = await Promise.allSettled(configs.map(config => fetchConfigMessages(config, recipient)))
  const successful = settled
    .filter(
      (result): result is PromiseFulfilledResult<{
        messages: CodeflixMessage[]
        totalScanned: number
        variantsScanned: string[]
      }> => result.status === 'fulfilled'
    )
    .map(result => result.value)
  const failed = settled.filter((result): result is PromiseRejectedResult => result.status === 'rejected')

  if (successful.length === 0 && failed.length > 0) {
    const firstError = failed[0].reason
    throw firstError instanceof Error ? firstError : new Error('Codeflix no pudo completar la busqueda.')
  }

  return {
    messages: successful.flatMap(result => result.messages),
    totalScanned: successful.reduce((sum, result) => sum + result.totalScanned, 0),
    variantsScanned: Array.from(new Set(successful.flatMap(result => result.variantsScanned))),
  }
}
