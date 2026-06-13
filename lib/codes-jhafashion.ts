import { stripHtml } from './lemon-parser'
import { type CodePlatformKey } from './codes-shared'

export type JhafashionMessage = {
  uid: number
  subject: string
  from: string
  to: string[]
  date: Date
  bodyText: string
  bodyHtml: string
  messageId: string
  platform: 'netflix'
  source: 'jhafashion'
  variantLabel: string
}

type JhafashionSearch = {
  platform: 'Actualizar' | 'Netflix' | 'Netflix15'
  subject: string
  variantLabel: string
}

const DEFAULT_BASE_URL = 'https://temp.jhafashion.site'
const SEARCHES: JhafashionSearch[] = [
  {
    platform: 'Netflix',
    subject: 'Netflix: Codigo de acceso temporal',
    variantLabel: 'Codigo Temporal',
  },
  {
    platform: 'Actualizar',
    subject: 'Netflix: Actualizar hogar',
    variantLabel: 'Actualizar Hogar',
  },
  {
    platform: 'Netflix15',
    subject: 'Netflix: Codigo de inicio de sesion',
    variantLabel: 'Codigo 15 Min',
  },
]

const normalizeText = (value: string | null | undefined) => (value || '').trim()
const normalizeEmail = (value: string) => normalizeText(value).toLowerCase()
const normalizeBaseUrl = (value: string | null | undefined) => normalizeText(value).replace(/\/+$/, '')

const sanitizeHtml = (html: string) =>
  html
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, '')
    .replace(/\son\w+\s*=\s*(['"]).*?\1/gi, '')
    .replace(/\son\w+\s*=\s*[^ >]+/gi, '')
    .replace(/href\s*=\s*(['"])\s*javascript:[^'"]*\1/gi, 'href="#"')
    .trim()

const hashText = (value: string) => {
  let hash = 0
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0
  }
  return hash || 1
}

const extractResultHtml = (pageHtml: string) => {
  const modalIndex = pageHtml.search(/<div[^>]+id=["']resultModal["']/i)
  if (modalIndex < 0) return ''

  const modalHtml = pageHtml.slice(modalIndex)
  const bodyMatch = modalHtml.match(/<div[^>]+class=["'][^"']*\bmodal-body\b[^"']*["'][^>]*>/i)
  if (!bodyMatch || bodyMatch.index === undefined) return ''

  const contentStart = bodyMatch.index + bodyMatch[0].length
  const contentTail = modalHtml.slice(contentStart)
  const scriptIndex = contentTail.search(/<script\b/i)
  const rawContent = scriptIndex >= 0 ? contentTail.slice(0, scriptIndex) : contentTail

  return sanitizeHtml(rawContent.replace(/(?:\s*<\/div>){3,}\s*$/i, ''))
}

const isEmptyResult = (html: string) => {
  const text = stripHtml(html)
  return !text || /\b0\s+mensajes?\s+encontrados?\b/i.test(text)
}

const search = async (params: {
  baseUrl: string
  recipient: string
  search: JhafashionSearch
}): Promise<JhafashionMessage | null> => {
  const response = await fetch(`${params.baseUrl}/mail_data_extractor.php`, {
    method: 'POST',
    headers: {
      Accept: 'text/html,application/xhtml+xml',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      email: params.recipient,
      platform: params.search.platform,
    }),
    cache: 'no-store',
    redirect: 'follow',
  })

  if (!response.ok) {
    throw new Error(`JHA Fashion devolvio estado ${response.status} al buscar.`)
  }

  const pageHtml = await response.text()
  const bodyHtml = extractResultHtml(pageHtml)
  if (isEmptyResult(bodyHtml)) return null

  const bodyText = stripHtml(bodyHtml)
  const date = new Date()
  const uid = hashText(`${params.search.platform}:${params.recipient}:${bodyText}`)

  return {
    uid,
    subject: params.search.subject,
    from: 'JHA Fashion',
    to: [params.recipient],
    date,
    bodyText,
    bodyHtml,
    messageId: `jhafashion:${uid}`,
    platform: 'netflix',
    source: 'jhafashion',
    variantLabel: `JHA Fashion - ${params.search.variantLabel}`,
  }
}

export const isJhafashionConfigured = () =>
  normalizeText(process.env.JHAFASHION_DISABLED).toLowerCase() !== 'true'

export const fetchJhafashionMessages = async (params: {
  platform: CodePlatformKey
  recipient: string
}): Promise<{ messages: JhafashionMessage[]; totalScanned: number; variantsScanned: string[] }> => {
  if (params.platform !== 'netflix' || !isJhafashionConfigured()) {
    return { messages: [], totalScanned: 0, variantsScanned: [] }
  }

  const recipient = normalizeEmail(params.recipient)
  const baseUrl = normalizeBaseUrl(process.env.JHAFASHION_BASE_URL) || DEFAULT_BASE_URL
  const settled = await Promise.allSettled(
    SEARCHES.map(searchConfig => search({ baseUrl, recipient, search: searchConfig }))
  )
  const messages = settled.flatMap(result =>
    result.status === 'fulfilled' && result.value ? [result.value] : []
  )
  const failures = settled.filter(result => result.status === 'rejected')

  if (messages.length === 0 && failures.length === settled.length) {
    const firstError = failures[0]?.reason
    throw firstError instanceof Error ? firstError : new Error('JHA Fashion no pudo completar la busqueda.')
  }

  return {
    messages,
    totalScanned: SEARCHES.length,
    variantsScanned: SEARCHES.map(item => `JHA Fashion - ${item.variantLabel}`),
  }
}
