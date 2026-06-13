import { stripHtml } from './lemon-parser'
import { type CodePlatformKey } from './codes-shared'

export type SdnetpanelMessage = {
  uid: number
  subject: string
  from: string
  to: string[]
  date: Date
  bodyText: string
  bodyHtml: string
  messageId: string
  platform: CodePlatformKey
  source: 'sdnetpanel'
  variantLabel: string
}

type SdnetpanelConfig = {
  baseUrl: string
  email: string
  id: string
  label: string
  maxItems: number
  password: string
}

type SdnetpanelFunction = {
  email: string | null
  id: number
  name: string
  status: number | boolean
  subjects: string[]
}

type SdnetpanelService = {
  functions?: SdnetpanelFunction[]
  id: number
  name: string
}

type SdnetpanelAccount = {
  id?: number | string | null
  current_owner?: {
    id?: number | string | null
  } | null
  service_id?: number | string | null
  type?: string | null
  user_id?: number | string | null
  username?: string | null
}

type SdnetpanelSearchResponse = {
  body?: string | null
  created_at?: string | null
  date?: string | null
  from?: string | null
  html?: string | null
  id?: number | string | null
  message_id?: string | null
  messageId?: string | null
  subject?: string | null
  text?: string | null
}

const DEFAULT_MAX_ITEMS = 3

const SDNETPANEL_SERVICE_MAP: Partial<Record<CodePlatformKey, string>> = {
  disney: 'Disney+',
  hbo: 'Max',
  netflix: 'Netflix',
}

const normalizeText = (value: string | null | undefined) => (value || '').trim()
const normalizeBaseUrl = (value: string | null | undefined) => normalizeText(value).replace(/\/+$/, '')
const readString = (value: unknown) =>
  typeof value === 'string' ? value : typeof value === 'number' || typeof value === 'boolean' ? String(value) : ''
const normalizeEmail = (value: string) => normalizeText(value).toLowerCase()

const toPositiveInt = (value: string | undefined, fallback: number) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback
}

const buildAccountId = (baseUrl: string, email: string) =>
  `${baseUrl.toLowerCase()}|${email.toLowerCase()}`.replace(/[^a-z0-9|._:@/-]+/g, '-')

const buildAccountLabel = (email: string, fallback?: string | null) => {
  const explicit = normalizeText(fallback)
  if (explicit) return explicit
  const local = email.split('@')[0]?.trim()
  return local || email
}

const sanitizeHtml = (html: string) =>
  html
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, '')
    .replace(/\son\w+\s*=\s*(['"]).*?\1/gi, '')
    .replace(/\son\w+\s*=\s*[^ >]+/gi, '')
    .replace(/href\s*=\s*(['"])\s*javascript:[^'"]*\1/gi, 'href="#"')
    .trim()

const parseDate = (value: string | null | undefined) => {
  const normalized = normalizeText(value)
  if (!normalized) return new Date()

  const parsed = new Date(normalized)
  if (!Number.isNaN(parsed.getTime())) return parsed

  return new Date()
}

const getLegacyConfig = (): SdnetpanelConfig | null => {
  const email = normalizeText(process.env.SDNETPANEL_USERNAME)
  const password = normalizeText(process.env.SDNETPANEL_PASSWORD)
  if (!email || !password) return null

  const baseUrl = normalizeBaseUrl(process.env.SDNETPANEL_BASE_URL) || 'https://sdnetpanel.com'
  return {
    baseUrl,
    email,
    id: buildAccountId(baseUrl, email),
    label: buildAccountLabel(email),
    maxItems: toPositiveInt(process.env.SDNETPANEL_MAX_ITEMS, DEFAULT_MAX_ITEMS),
    password,
  }
}

const getJsonConfigs = (): SdnetpanelConfig[] => {
  const raw = normalizeText(process.env.SDNETPANEL_ACCOUNTS_JSON)
  if (!raw) return []

  const mapAccountRecord = (record: Record<string, unknown>, index: number, fallbackBaseUrl: string, fallbackMaxItems: number) => {
    const email = normalizeText(readString(record.email) || readString(record.username))
    const password = normalizeText(readString(record.password))
    if (!email || !password) return null

    const baseUrl = normalizeBaseUrl(readString(record.baseUrl)) || fallbackBaseUrl
    const rawMaxItems = readString(record.maxItems)

    return {
      baseUrl,
      email,
      id: normalizeText(readString(record.id)) || buildAccountId(baseUrl, email),
      label: buildAccountLabel(email, readString(record.label) || readString(record.name) || `Cuenta ${index + 1}`),
      maxItems: toPositiveInt(rawMaxItems || String(fallbackMaxItems), fallbackMaxItems),
      password,
    }
  }

  const parseLooseAccounts = (value: string) => {
    const trimmed = value.trim()
    if (!trimmed.startsWith('[') || !trimmed.endsWith(']')) return []

    return trimmed
      .slice(1, -1)
      .split(/}\s*,\s*{/)
      .map((chunk, index) => {
        const body = chunk.replace(/^\s*{/, '').replace(/}\s*$/, '')
        const record: Record<string, string> = {}

        for (const pair of body.split(/\s*,\s*/)) {
          const separator = pair.indexOf(':')
          if (separator <= 0) continue
          const key = pair.slice(0, separator).trim().replace(/^['"]|['"]$/g, '')
          const value = pair.slice(separator + 1).trim().replace(/^['"]|['"]$/g, '')
          if (key) record[key] = value
        }

        return Object.keys(record).length > 0 ? { record, index } : null
      })
      .filter((item): item is { record: Record<string, string>; index: number } => Boolean(item))
  }

  const fallbackBaseUrl = normalizeBaseUrl(process.env.SDNETPANEL_BASE_URL) || 'https://sdnetpanel.com'
  const fallbackMaxItems = toPositiveInt(process.env.SDNETPANEL_MAX_ITEMS, DEFAULT_MAX_ITEMS)

  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []

    return parsed
      .map((item, index) => {
        if (!item || typeof item !== 'object') return null
        return mapAccountRecord(item as Record<string, unknown>, index, fallbackBaseUrl, fallbackMaxItems)
      })
      .filter((config): config is SdnetpanelConfig => Boolean(config))
  } catch {
    return parseLooseAccounts(raw)
      .map(item => mapAccountRecord(item.record, item.index, fallbackBaseUrl, fallbackMaxItems))
      .filter((config): config is SdnetpanelConfig => Boolean(config))
  }
}

const getConfig = (): SdnetpanelConfig[] => {
  const jsonConfigs = getJsonConfigs()
  if (jsonConfigs.length > 0) return jsonConfigs

  const legacyConfig = getLegacyConfig()
  return legacyConfig ? [legacyConfig] : []
}

const isLikelyGlobalMessageId = (value: string) => value.includes('@') || (value.startsWith('<') && value.endsWith('>'))

const getScopedMessageId = (accountId: string, rawMessageId: string, fallback: string) => {
  if (!rawMessageId) return fallback
  return isLikelyGlobalMessageId(rawMessageId) ? rawMessageId : `${accountId}:${rawMessageId}`
}

const login = async (config: SdnetpanelConfig) => {
  const response = await fetch(`${config.baseUrl}/api/login`, {
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

  if (!response.ok) {
    throw new Error(`SDPanel devolvio estado ${response.status} al iniciar sesion.`)
  }

  const payload = (await response.json()) as { token?: string }
  const token = normalizeText(payload.token)
  if (!token) {
    throw new Error('SDPanel no devolvio un token de sesion valido.')
  }

  return token
}

const readServices = async (params: { baseUrl: string; token: string }) => {
  const response = await fetch(`${params.baseUrl}/api/services`, {
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${params.token}`,
    },
    cache: 'no-store',
  })

  if (!response.ok) {
    throw new Error(`SDPanel devolvio estado ${response.status} al cargar servicios.`)
  }

  return (await response.json()) as SdnetpanelService[]
}

const toAccountItems = (payload: unknown) => {
  if (Array.isArray(payload)) return payload as SdnetpanelAccount[]
  if (payload && typeof payload === 'object' && Array.isArray((payload as { data?: unknown[] }).data)) {
    return (payload as { data: SdnetpanelAccount[] }).data
  }
  return []
}

const toObject = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}

const readPayloadId = (payload: unknown) => {
  const record = toObject(payload)
  const data = toObject(record.data)
  return readString(record.id) || readString(data.id)
}

const findCanonicalAccount = async (params: {
  baseUrl: string
  recipient: string
  token: string
}) => {
  const target = normalizeEmail(params.recipient)
  const response = await fetch(
    `${params.baseUrl}/api/service-accounts?search=${encodeURIComponent(target)}&per_page=25`,
    {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${params.token}`,
      },
      cache: 'no-store',
    }
  )

  if (!response.ok) return null

  const payload = await response.json()
  return (
    toAccountItems(payload).find(account => normalizeEmail(readString(account.username)) === target) || null
  )
}

const findCanonicalAccountUsername = async (params: {
  baseUrl: string
  recipient: string
  token: string
}) => {
  const account = await findCanonicalAccount(params)
  return normalizeEmail(readString(account?.username)) || null
}

const findServiceForPlatform = (services: SdnetpanelService[], platform: CodePlatformKey) => {
  const targetName = SDNETPANEL_SERVICE_MAP[platform]
  if (!targetName) return null

  return services.find(service => normalizeText(service.name).toLowerCase() === targetName.toLowerCase()) || null
}

const toSearchItems = (payload: unknown) => {
  if (Array.isArray(payload)) return payload as SdnetpanelSearchResponse[]
  if (payload && typeof payload === 'object' && Array.isArray((payload as { data?: unknown[] }).data)) {
    return (payload as { data: SdnetpanelSearchResponse[] }).data
  }
  return payload && typeof payload === 'object' ? [payload as SdnetpanelSearchResponse] : []
}

const parseSearchResponse = (params: {
  accountId: string
  accountLabel: string
  functionId: number
  items: SdnetpanelSearchResponse[]
  maxItems: number
  platform: CodePlatformKey
  recipient: string
  variantLabel: string
}) => {
  return params.items.slice(0, params.maxItems).map((item, index) => {
    const subject = normalizeText(item.subject) || 'Mensaje automatico'
    const rawBody = normalizeText(item.html) || normalizeText(item.body)
    const bodyHtml = rawBody ? sanitizeHtml(rawBody) : ''
    const bodyText = normalizeText(item.text) || stripHtml(bodyHtml)
    const uidBase = Number(item.id)
    const uid = Number.isFinite(uidBase) && uidBase > 0 ? uidBase : params.functionId * 1000 + index + 1
    const rawMessageId = normalizeText(item.message_id) || normalizeText(item.messageId)
    const messageId = getScopedMessageId(
      params.accountId,
      rawMessageId,
      `sdnetpanel:${params.accountId}:${params.platform}:${params.functionId}:${uid}:${index}`
    )
    const variantLabel = params.accountLabel ? `${params.accountLabel} - ${params.variantLabel}` : params.variantLabel

    return {
      uid,
      subject,
      from: normalizeText(item.from) || '-',
      to: [params.recipient],
      date: parseDate(item.date || item.created_at),
      bodyText,
      bodyHtml,
      messageId,
      platform: params.platform,
      source: 'sdnetpanel' as const,
      variantLabel,
    }
  })
}

const searchFunctionMessages = async (params: {
  accountId: string
  accountLabel: string
  baseUrl: string
  func: SdnetpanelFunction
  maxItems: number
  platform: CodePlatformKey
  recipient: string
  token: string
}): Promise<SdnetpanelMessage[]> => {
  const destination = normalizeText(params.func.email) || params.recipient
  if (!destination || params.func.subjects.length === 0) return []

  const response = await fetch(`${params.baseUrl}/api/search-email/all`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${params.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      subjects: params.func.subjects,
      to: destination,
    }),
    cache: 'no-store',
  })

  if (response.status === 404) {
    return []
  }

  if (!response.ok) {
    throw new Error(`SDPanel devolvio estado ${response.status} al buscar correos.`)
  }

  const payload = await response.json()
  return parseSearchResponse({
    accountId: params.accountId,
    accountLabel: params.accountLabel,
    functionId: params.func.id,
    items: toSearchItems(payload),
    maxItems: params.maxItems,
    platform: params.platform,
    recipient: destination,
    variantLabel: params.func.name,
  })
}

export const isSdnetpanelConfigured = () => getConfig().length > 0

const fetchConfigMessages = async (config: SdnetpanelConfig, params: { platform: CodePlatformKey; recipient: string }) => {
  const token = await login(config)
  const [services, recipient] = await Promise.all([
    readServices({ baseUrl: config.baseUrl, token }),
    findCanonicalAccountUsername({
      baseUrl: config.baseUrl,
      recipient: params.recipient,
      token,
    }),
  ])

  if (!recipient) {
    return {
      accountFound: false,
      messages: [] as SdnetpanelMessage[],
      totalScanned: 0,
      variantsScanned: [] as string[],
    }
  }

  const service = findServiceForPlatform(services, params.platform)
  if (!service) {
    return {
      accountFound: true,
      messages: [] as SdnetpanelMessage[],
      totalScanned: 0,
      variantsScanned: [] as string[],
    }
  }

  const functions = (service.functions || []).filter(func => Boolean(func.status) && func.subjects.length > 0)
  if (functions.length === 0) {
    return {
      accountFound: true,
      messages: [] as SdnetpanelMessage[],
      totalScanned: 0,
      variantsScanned: [] as string[],
    }
  }

  const settled = await Promise.allSettled(
    functions.map(func =>
      searchFunctionMessages({
        accountId: config.id,
        accountLabel: config.label,
        baseUrl: config.baseUrl,
        func,
        maxItems: config.maxItems,
        platform: params.platform,
        recipient,
        token,
      })
    )
  )
  const messages = settled.flatMap(result => (result.status === 'fulfilled' ? result.value : []))

  return {
    accountFound: true,
    messages,
    totalScanned: messages.length,
    variantsScanned: functions.map(func => `${config.label} - ${func.name}`).filter(Boolean),
  }
}

export const fetchSdnetpanelMessages = async (params: {
  platform: CodePlatformKey
  recipient: string
}): Promise<{ messages: SdnetpanelMessage[]; totalScanned: number; variantsScanned: string[] }> => {
  const configs = getConfig()
  if (configs.length === 0) {
    return { messages: [], totalScanned: 0, variantsScanned: [] }
  }

  const successful: Array<{
    accountFound: boolean
    messages: SdnetpanelMessage[]
    totalScanned: number
    variantsScanned: string[]
  }> = []
  const failed: unknown[] = []

  for (const config of configs) {
    try {
      const result = await fetchConfigMessages(config, {
        platform: params.platform,
        recipient: params.recipient,
      })
      successful.push(result)

      // Each service account belongs to one SDNetPanel session. Once found,
      // querying later sessions can only add latency or unrelated results.
      if (result.accountFound) break
    } catch (error) {
      failed.push(error)
    }
  }

  if (successful.length === 0 && failed.length > 0) {
    const firstError = failed[0]
    throw firstError instanceof Error ? firstError : new Error('SDPanel no pudo cargar ninguna cuenta.')
  }

  const messages = successful.flatMap(result => result.messages)
  const totalScanned = successful.reduce((sum, result) => sum + result.totalScanned, 0)
  const variantsScanned = Array.from(
    new Set(successful.flatMap(result => result.variantsScanned).filter(Boolean))
  )

  return {
    messages,
    totalScanned,
    variantsScanned,
  }
}

const extractTextFromUnknown = (value: unknown): string => {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) return value.map(extractTextFromUnknown).join('\n')
  if (typeof value !== 'object') return ''

  const record = value as Record<string, unknown>
  return Object.entries(record)
    .filter(([key]) => !['html', 'body_html'].includes(key.toLowerCase()))
    .map(([, item]) => extractTextFromUnknown(item))
    .filter(Boolean)
    .join('\n')
}

const extractReplacementEmail = (text: string, previousEmail: string) => {
  const previous = normalizeEmail(previousEmail)
  const targetedPatterns = [
    /cuenta\s+asignada\s+exitosamente[\s\S]{0,80}?cuenta\s*[:：]\s*([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})/i,
    /nueva\s+cuenta(?:\s+de\s+cambio\s+automatico)?\s*[:：]\s*([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})/i,
    /cuenta\s+de\s+cambio\s+automatico\s*[:：]\s*([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})/i,
    /reemplazo[\s\S]{0,80}?([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})/i,
  ]

  for (const pattern of targetedPatterns) {
    const match = text.match(pattern)
    const email = normalizeEmail(match?.[1] || '')
    if (email && email !== previous) return email
  }

  return ''
}

const sdnetpanelJson = async (params: {
  baseUrl: string
  body?: Record<string, unknown>
  method?: string
  path: string
  token: string
}) => {
  const response = await fetch(`${params.baseUrl}${params.path}`, {
    method: params.method || 'GET',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${params.token}`,
      ...(params.body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: params.body ? JSON.stringify(params.body) : undefined,
    cache: 'no-store',
  })

  const text = await response.text()
  const payload = text
    ? (() => {
        try {
          return JSON.parse(text) as unknown
        } catch {
          return { message: text }
        }
      })()
    : null

  if (!response.ok) {
    const message = normalizeText(readString(toObject(payload).message)) || `SDPanel devolvio estado ${response.status}.`
    const error = new Error(message) as Error & { status?: number; payload?: unknown }
    error.status = response.status
    error.payload = payload
    throw error
  }

  return payload
}

const readTicketDetail = async (params: { baseUrl: string; ticketId: string; token: string }) => {
  if (!params.ticketId) return null
  try {
    return await sdnetpanelJson({
      baseUrl: params.baseUrl,
      path: `/api/support/tickets/${encodeURIComponent(params.ticketId)}`,
      token: params.token,
    })
  } catch {
    return null
  }
}

const getTicketServiceAccount = (ticketDetail: unknown, fallback: SdnetpanelAccount) => {
  const detail = toObject(ticketDetail)
  const data = toObject(detail.data)
  return (toObject(detail.service_account).id || toObject(detail.service_account).username
    ? toObject(detail.service_account)
    : toObject(data.service_account).id || toObject(data.service_account).username
      ? toObject(data.service_account)
      : fallback) as SdnetpanelAccount
}

const buildGuaranteePayload = (params: {
  account: SdnetpanelAccount
  ticketDetail: unknown
  ticketId: string
}) => {
  const detail = toObject(params.ticketDetail)
  const data = toObject(detail.data)
  const serviceAccount = getTicketServiceAccount(params.ticketDetail, params.account)
  const owner = toObject(serviceAccount.current_owner)
  const userId =
    readString(owner.id) ||
    readString(serviceAccount.user_id) ||
    readString(detail.user_id) ||
    readString(data.user_id)

  return {
    account_id: readString(serviceAccount.id) || readString(params.account.id),
    service_id: readString(serviceAccount.service_id) || readString(params.account.service_id),
    ticket_id: params.ticketId,
    type: readString(serviceAccount.type) || readString(params.account.type) || 'Cuenta completa',
    user_id: userId,
  }
}

export type SdnetpanelNoPaymentReplacementResult =
  | {
      status: 'replaced'
      providerLabel: string
      providerMessage: string
      replacementEmail: string
      sdnetpanelTicketId: string
    }
  | {
      status: 'waiting'
      providerLabel: string | null
      providerMessage: string
      sdnetpanelTicketId?: string
    }

export const resolveSdnetpanelNoPaymentReplacement = async (params: {
  accountEmail: string
}): Promise<SdnetpanelNoPaymentReplacementResult> => {
  const configs = getConfig()
  const previousEmail = normalizeEmail(params.accountEmail)

  if (configs.length === 0) {
    return {
      status: 'waiting',
      providerLabel: null,
      providerMessage:
        'En unos momentos el proveedor te atendera. Por ahora estamos sin reemplazos disponibles, pero ya quedo reportado.',
    }
  }

  let lastMessage =
    'En unos momentos el proveedor te atendera. Por ahora estamos sin reemplazos disponibles, pero ya quedo reportado.'

  for (const config of configs) {
    let foundOriginalAccount = false
    try {
      const token = await login(config)
      const account = await findCanonicalAccount({
        baseUrl: config.baseUrl,
        recipient: previousEmail,
        token,
      })

      const accountUsername = normalizeEmail(readString(account?.username))
      if (!account?.id || !accountUsername) continue
      foundOriginalAccount = true

      const ticketPayload = await sdnetpanelJson({
        baseUrl: config.baseUrl,
        method: 'POST',
        path: '/api/support/tickets',
        token,
        body: {
          category: 'Cuenta caida',
          description: 'Quiero ingresar a la cuenta pero no tiene una suscripon activa',
          title: 'La cuenta esta sin pago',
          username: accountUsername,
        },
      })
      const ticketId = readPayloadId(ticketPayload)
      let ticketDetail = await readTicketDetail({ baseUrl: config.baseUrl, ticketId, token })

      if (ticketId) {
        await sdnetpanelJson({
          baseUrl: config.baseUrl,
          method: 'POST',
          path: `/api/support/tickets/${encodeURIComponent(ticketId)}/messages`,
          token,
          body: {
            message: 'Por favor, necesito un cambio de cuenta.',
          },
        }).catch(() => null)
      }

      const guaranteePayload = buildGuaranteePayload({
        account,
        ticketDetail,
        ticketId,
      })
      const assignPayload =
        guaranteePayload.account_id && guaranteePayload.service_id && guaranteePayload.ticket_id && guaranteePayload.user_id
          ? await sdnetpanelJson({
              baseUrl: config.baseUrl,
              method: 'POST',
              path: '/api/service-accounts/assign-guarantee',
              token,
              body: guaranteePayload,
            }).catch(() => {
              lastMessage =
                'En unos momentos el proveedor te atendera. Por ahora estamos sin reemplazos disponibles, pero ya quedo reportado.'
              return null
            })
          : null

      if (ticketId) {
        await sdnetpanelJson({
          baseUrl: config.baseUrl,
          method: 'PUT',
          path: `/api/support/tickets/${encodeURIComponent(ticketId)}/status`,
          token,
          body: {
            ByPass: true,
            status: 'En progreso',
          },
        }).catch(() => null)
      }

      ticketDetail = await readTicketDetail({ baseUrl: config.baseUrl, ticketId, token })
      const combinedText = [extractTextFromUnknown(assignPayload), extractTextFromUnknown(ticketDetail)]
        .filter(Boolean)
        .join('\n')
      const replacementEmail = extractReplacementEmail(combinedText, previousEmail)
      if (replacementEmail) {
        return {
          status: 'replaced',
          providerLabel: config.label,
          providerMessage: combinedText.slice(0, 800) || `Cuenta asignada exitosamente. Cuenta: ${replacementEmail}`,
          replacementEmail,
          sdnetpanelTicketId: ticketId,
        }
      }

      if (/no\s+hay\s+cuentas\s+disponibles/i.test(combinedText)) {
        return {
          status: 'waiting',
          providerLabel: config.label,
          providerMessage:
            'En unos momentos el proveedor te atendera. Por ahora estamos sin reemplazos disponibles, pero ya quedo reportado.',
          sdnetpanelTicketId: ticketId,
        }
      }

      return {
        status: 'waiting',
        providerLabel: config.label,
        providerMessage:
          lastMessage ||
          'En unos momentos el proveedor te atendera. Por ahora estamos sin reemplazos disponibles, pero ya quedo reportado.',
        sdnetpanelTicketId: ticketId,
      }
    } catch {
      lastMessage =
        'En unos momentos el proveedor te atendera. Por ahora estamos sin reemplazos disponibles, pero ya quedo reportado.'
      if (foundOriginalAccount) {
        return {
          status: 'waiting',
          providerLabel: config.label,
          providerMessage: lastMessage,
        }
      }
    }
  }

  return {
    status: 'waiting',
    providerLabel: null,
    providerMessage:
      lastMessage ||
      'En unos momentos el proveedor te atendera. Por ahora estamos sin reemplazos disponibles, pero ya quedo reportado.',
  }
}
