import { stripHtml } from './lemon-parser'
import { type CodePlatformKey } from './codes-shared'

export type GlowpremMessage = {
  uid: number
  subject: string
  from: string
  to: string[]
  date: Date
  bodyText: string
  bodyHtml: string
  messageId: string
  platform: CodePlatformKey
  source: 'glowprem'
}

type GlowpremConfig = {
  baseUrl: string
  maxItems: number
  password: string
  username: string
}

type GlowpremSearchItem = {
  asunto?: string | null
  fecha?: string | null
  id?: number | string | null
}

const DEFAULT_MAX_ITEMS = 3
const DEFAULT_FROM = 'disneyplus@trx.mail2.disneyplus.com'

const normalizeText = (value: string | null | undefined) => (value || '').trim()

const toPositiveInt = (value: string | undefined, fallback: number) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback
}

const sanitizeHtml = (html: string) =>
  html
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, '')
    .replace(/\son\w+\s*=\s*(['"]).*?\1/gi, '')
    .replace(/\son\w+\s*=\s*[^ >]+/gi, '')
    .replace(/href\s*=\s*(['"])\s*javascript:[^'"]*\1/gi, 'href="#"')
    .trim()

const parseDateLabel = (value: string | null | undefined) => {
  const normalized = normalizeText(value)
  if (!normalized) return new Date()

  const now = new Date()
  const currentYear = now.getFullYear()
  const parsed = new Date(`${normalized} ${currentYear}`)
  if (!Number.isNaN(parsed.getTime())) {
    if (parsed.getTime() > now.getTime() + 1000 * 60 * 60 * 24 * 7) {
      parsed.setFullYear(currentYear - 1)
    }
    return parsed
  }

  return now
}

const getConfig = (): GlowpremConfig | null => {
  if (normalizeText(process.env.GLOWPREM_DISABLED).toLowerCase() === 'true') {
    return null
  }

  return {
    baseUrl: normalizeText(process.env.GLOWPREM_BASE_URL) || 'https://glowprem.xyz',
    maxItems: toPositiveInt(process.env.GLOWPREM_MAX_ITEMS, DEFAULT_MAX_ITEMS),
    password: normalizeText(process.env.GLOWPREM_PASSWORD),
    username: normalizeText(process.env.GLOWPREM_USERNAME),
  }
}

const getResponseCookie = (headers: Headers) => {
  const withGetSetCookie = headers as Headers & { getSetCookie?: () => string[] }
  const cookieValues =
    typeof withGetSetCookie.getSetCookie === 'function' ? withGetSetCookie.getSetCookie() : []
  const rawCookie = cookieValues[0] || headers.get('set-cookie') || ''
  return rawCookie.split(';')[0]?.trim() || ''
}

const loginIfNeeded = async (config: GlowpremConfig) => {
  if (!config.username || !config.password) return ''

  const body = new FormData()
  body.append('user', config.username)
  body.append('pass', config.password)

  const response = await fetch(`${config.baseUrl}/auth.php?action=login`, {
    method: 'POST',
    body,
    cache: 'no-store',
  })

  if (!response.ok) {
    throw new Error(`Glowprem devolvio estado ${response.status} al iniciar sesion.`)
  }

  const payload = (await response.json()) as { success?: boolean; msg?: string }
  if (!payload.success) {
    throw new Error(normalizeText(payload.msg) || 'Glowprem no permitio iniciar sesion.')
  }

  return getResponseCookie(response.headers)
}

const postGlowprem = async (params: {
  baseUrl: string
  cookie: string
  formData: FormData
}): Promise<Response> => {
  const headers = params.cookie ? { Cookie: params.cookie } : undefined
  return fetch(`${params.baseUrl}/consultar.php`, {
    method: 'POST',
    body: params.formData,
    headers,
    cache: 'no-store',
  })
}

const readList = async (params: {
  baseUrl: string
  cookie: string
  recipient: string
}) => {
  const body = new FormData()
  body.append('email', params.recipient)
  body.append('service', 'disney')

  const response = await postGlowprem({
    baseUrl: params.baseUrl,
    cookie: params.cookie,
    formData: body,
  })

  if (!response.ok) {
    throw new Error(`Glowprem devolvio estado ${response.status} al buscar codigos Disney.`)
  }

  const payload = (await response.json()) as { lista?: GlowpremSearchItem[] }
  return Array.isArray(payload.lista) ? payload.lista : []
}

const readMessage = async (params: {
  baseUrl: string
  cookie: string
  item: GlowpremSearchItem
  recipient: string
}): Promise<GlowpremMessage | null> => {
  const uid = Number(params.item.id)
  if (!Number.isFinite(uid) || uid <= 0) return null

  const body = new FormData()
  body.append('msg_id', String(uid))
  body.append('service', 'disney')

  const response = await postGlowprem({
    baseUrl: params.baseUrl,
    cookie: params.cookie,
    formData: body,
  })

  if (!response.ok) return null

  const payload = (await response.json()) as { contenido?: string | null }
  const rawHtml = normalizeText(payload.contenido)
  const bodyHtml = rawHtml ? sanitizeHtml(rawHtml) : ''
  const bodyText = stripHtml(bodyHtml)

  return {
    uid,
    subject: normalizeText(params.item.asunto) || 'Codigo Disney+',
    from: DEFAULT_FROM,
    to: [params.recipient],
    date: parseDateLabel(params.item.fecha),
    bodyText,
    bodyHtml,
    messageId: `glowprem:disney:${uid}`,
    platform: 'disney',
    source: 'glowprem',
  }
}

export const isGlowpremConfigured = () => Boolean(getConfig())

export const fetchGlowpremMessages = async (params: {
  platform: CodePlatformKey
  recipient: string
}): Promise<{ messages: GlowpremMessage[]; totalScanned: number }> => {
  if (params.platform !== 'disney') {
    return { messages: [], totalScanned: 0 }
  }

  const config = getConfig()
  if (!config) {
    return { messages: [], totalScanned: 0 }
  }

  const cookie = await loginIfNeeded(config)
  const items = await readList({
    baseUrl: config.baseUrl,
    cookie,
    recipient: params.recipient,
  })

  const limitedItems = items.slice(0, config.maxItems)
  const messages = await Promise.all(
    limitedItems.map(item =>
      readMessage({
        baseUrl: config.baseUrl,
        cookie,
        item,
        recipient: params.recipient,
      })
    )
  )

  return {
    messages: messages.filter((value): value is GlowpremMessage => Boolean(value)),
    totalScanned: items.length,
  }
}
