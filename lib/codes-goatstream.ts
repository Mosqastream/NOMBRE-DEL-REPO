import { stripHtml } from './lemon-parser'
import { type CodePlatformKey } from './codes-shared'

export type GoatstreamMessage = {
  uid: number
  subject: string
  from: string
  to: string[]
  date: Date
  bodyText: string
  bodyHtml: string
  messageId: string
  platform: CodePlatformKey
  source: 'goatstream'
}

type GoatstreamSearchCard = {
  dateLabel: string
  fromLabel: string
  href: string
  msgno: number
  subject: string
}

type GoatstreamConfig = {
  baseUrl: string
  maxItems: number
  password: string
  username: string
}

const DEFAULT_MAX_ITEMS = 3

const GOATSTREAM_SERVICE_MAP: Partial<Record<CodePlatformKey, string>> = {
  disney: 'disney',
  netflix: 'netflix',
}

const normalizeText = (value: string | null | undefined) => (value || '').trim()

const decodeHtmlEntities = (value: string) =>
  value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_match, code) => String.fromCharCode(parseInt(code, 10)))

const sanitizeHtml = (html: string) =>
  html
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, '')
    .replace(/\son\w+\s*=\s*(['"]).*?\1/gi, '')
    .replace(/\son\w+\s*=\s*[^ >]+/gi, '')
    .replace(/href\s*=\s*(['"])\s*javascript:[^'"]*\1/gi, 'href="#"')
    .trim()

const toPositiveInt = (value: string | undefined, fallback: number) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback
}

const getGoatstreamConfig = (): GoatstreamConfig | null => {
  const username = normalizeText(process.env.GOATSTREAM_USERNAME)
  const password = normalizeText(process.env.GOATSTREAM_PASSWORD)
  if (!username || !password) return null

  return {
    baseUrl: normalizeText(process.env.GOATSTREAM_BASE_URL) || 'https://goatstream.fastcod.xyz',
    maxItems: toPositiveInt(process.env.GOATSTREAM_MAX_ITEMS, DEFAULT_MAX_ITEMS),
    password,
    username,
  }
}

const getResponseCookie = (headers: Headers) => {
  const withGetSetCookie = headers as Headers & { getSetCookie?: () => string[] }
  const cookieValues =
    typeof withGetSetCookie.getSetCookie === 'function' ? withGetSetCookie.getSetCookie() : []
  const rawCookie = cookieValues[0] || headers.get('set-cookie') || ''
  return rawCookie.split(';')[0]?.trim() || ''
}

const extractDivInnerHtmlByClass = (html: string, className: string) => {
  const classNeedle = `class="${className}"`
  const classIndex = html.indexOf(classNeedle)
  if (classIndex === -1) return ''

  const startIndex = html.lastIndexOf('<div', classIndex)
  if (startIndex === -1) return ''

  const openingEnd = html.indexOf('>', startIndex)
  if (openingEnd === -1) return ''

  let depth = 1
  let cursor = openingEnd + 1

  while (cursor < html.length) {
    const nextOpen = html.indexOf('<div', cursor)
    const nextClose = html.indexOf('</div', cursor)
    if (nextClose === -1) break

    if (nextOpen !== -1 && nextOpen < nextClose) {
      depth += 1
      const nextOpenEnd = html.indexOf('>', nextOpen)
      if (nextOpenEnd === -1) break
      cursor = nextOpenEnd + 1
      continue
    }

    depth -= 1
    if (depth === 0) {
      return html.slice(openingEnd + 1, nextClose)
    }

    const nextCloseEnd = html.indexOf('>', nextClose)
    if (nextCloseEnd === -1) break
    cursor = nextCloseEnd + 1
  }

  return ''
}

const extractDivBlocksByClass = (html: string, className: string) => {
  const blocks: string[] = []
  let searchIndex = 0

  while (searchIndex < html.length) {
    const classIndex = html.indexOf(`class="${className}"`, searchIndex)
    if (classIndex === -1) break

    const startIndex = html.lastIndexOf('<div', classIndex)
    if (startIndex === -1) break

    const openingEnd = html.indexOf('>', startIndex)
    if (openingEnd === -1) break

    let depth = 1
    let cursor = openingEnd + 1
    let foundEnd = -1

    while (cursor < html.length) {
      const nextOpen = html.indexOf('<div', cursor)
      const nextClose = html.indexOf('</div', cursor)
      if (nextClose === -1) break

      if (nextOpen !== -1 && nextOpen < nextClose) {
        depth += 1
        const nextOpenEnd = html.indexOf('>', nextOpen)
        if (nextOpenEnd === -1) break
        cursor = nextOpenEnd + 1
        continue
      }

      depth -= 1
      const nextCloseEnd = html.indexOf('>', nextClose)
      if (nextCloseEnd === -1) break

      if (depth === 0) {
        foundEnd = nextCloseEnd + 1
        blocks.push(html.slice(startIndex, foundEnd))
        searchIndex = foundEnd
        break
      }

      cursor = nextCloseEnd + 1
    }

    if (foundEnd === -1) break
  }

  return blocks
}

const extractMatch = (html: string, pattern: RegExp) => {
  const match = html.match(pattern)
  return match?.[1] ? decodeHtmlEntities(stripHtml(match[1])).trim() : ''
}

const parseGoatstreamDate = (value: string) => {
  const parsed = new Date(value)
  if (!Number.isNaN(parsed.getTime())) return parsed
  return new Date()
}

const parseSearchCards = (html: string, baseUrl: string) => {
  const cards = extractDivBlocksByClass(html, 'email-card')

  return cards
    .map(block => {
      const subject = extractMatch(block, /<div class="email-subject">([\s\S]*?)<\/div>/i)
      const spanMatches = Array.from(block.matchAll(/<span>([\s\S]*?)<\/span>/gi)).map(match =>
        decodeHtmlEntities(stripHtml(match[1])).trim()
      )
      const hrefMatch = block.match(/href="([^"]+)"/i)
      const href = hrefMatch?.[1] ? new URL(hrefMatch[1], `${baseUrl}/paginacodigo/`).toString() : ''
      const msgno = href ? Number(new URL(href).searchParams.get('msgno') || 0) : 0

      return {
        dateLabel: spanMatches[0] || '',
        fromLabel: spanMatches[1] || '',
        href,
        msgno,
        subject,
      } satisfies GoatstreamSearchCard
    })
    .filter(card => card.subject && card.href && card.msgno > 0)
}

const loginToGoatstream = async (config: GoatstreamConfig) => {
  const body = new URLSearchParams({
    contrasena: config.password,
    nombre_usuario: config.username,
  })

  const response = await fetch(`${config.baseUrl}/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
    cache: 'no-store',
    redirect: 'manual',
  })

  if (!response.ok && response.status !== 302) {
    throw new Error(`Goatstream devolvio estado ${response.status} al iniciar sesion.`)
  }

  const cookie = getResponseCookie(response.headers)
  if (!cookie) {
    throw new Error('Goatstream no entrego una cookie de sesion valida.')
  }

  return cookie
}

const fetchDetailMessage = async (params: {
  card: GoatstreamSearchCard
  config: GoatstreamConfig
  cookie: string
  platform: CodePlatformKey
  recipient: string
}): Promise<GoatstreamMessage | null> => {
  const response = await fetch(params.card.href, {
    headers: {
      Cookie: params.cookie,
    },
    cache: 'no-store',
  })

  if (!response.ok) {
    return null
  }

  const html = await response.text()
  const subject = extractMatch(html, /<h1 class="email-subject">([\s\S]*?)<\/h1>/i) || params.card.subject
  const metaMatches = Array.from(html.matchAll(/<div class="email-meta-item">[\s\S]*?<span>([\s\S]*?)<\/span>/gi)).map(
    match => decodeHtmlEntities(stripHtml(match[1])).trim()
  )
  const from = metaMatches[0] || params.card.fromLabel || '-'
  const dateLabel = metaMatches[1] || params.card.dateLabel || ''
  const bodyHtml = sanitizeHtml(extractDivInnerHtmlByClass(html, 'email-body-content'))
  const bodyText = stripHtml(bodyHtml)

  return {
    uid: params.card.msgno,
    subject,
    from,
    to: [params.recipient],
    date: parseGoatstreamDate(dateLabel),
    bodyText,
    bodyHtml,
    messageId: `goatstream:${params.platform}:${params.card.msgno}`,
    platform: params.platform,
    source: 'goatstream',
  }
}

export const isGoatstreamConfigured = () => Boolean(getGoatstreamConfig())

export const fetchGoatstreamMessages = async (params: {
  platform: CodePlatformKey
  recipient: string
}): Promise<{ messages: GoatstreamMessage[]; totalScanned: number }> => {
  const config = getGoatstreamConfig()
  if (!config) {
    return { messages: [], totalScanned: 0 }
  }

  const remoteService = GOATSTREAM_SERVICE_MAP[params.platform]
  if (!remoteService) {
    return { messages: [], totalScanned: 0 }
  }

  const cookie = await loginToGoatstream(config)
  const searchUrl = new URL('/paginacodigo/consultar.php', config.baseUrl)
  searchUrl.searchParams.set('servicio', remoteService)

  const searchBody = new URLSearchParams({
    correo_consultar: params.recipient,
  })

  const searchResponse = await fetch(searchUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Cookie: cookie,
    },
    body: searchBody,
    cache: 'no-store',
  })

  if (!searchResponse.ok) {
    throw new Error(`Goatstream devolvio estado ${searchResponse.status} al buscar correos.`)
  }

  const searchHtml = await searchResponse.text()
  const cards = parseSearchCards(searchHtml, config.baseUrl)
  const limitedCards = cards.slice(0, config.maxItems)

  const messages = await Promise.all(
    limitedCards.map(card =>
      fetchDetailMessage({
        card,
        config,
        cookie,
        platform: params.platform,
        recipient: params.recipient,
      })
    )
  )

  return {
    messages: messages.filter((value): value is GoatstreamMessage => Boolean(value)),
    totalScanned: cards.length,
  }
}
