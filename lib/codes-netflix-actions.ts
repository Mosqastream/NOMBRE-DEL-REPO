export type NetflixActionKind = 'travel' | 'household'

type NetflixActionRule = {
  label: string
  linkNeedles: string[]
  matchNeedles: string[]
  subjectNeedles: string[]
}

const NETFLIX_ACTION_RULES: Record<NetflixActionKind, NetflixActionRule> = {
  travel: {
    label: 'Obtener codigo',
    linkNeedles: ['obtener codigo', 'solicitar codigo', 'codigo temporal'],
    matchNeedles: ['acceso temporal', 'durante viajes', 'obtener codigo', 'solicitar codigo'],
    subjectNeedles: ['codigo de acceso temporal'],
  },
  household: {
    label: 'Actualizar hogar',
    linkNeedles: ['si, la envie yo', 'si la envie yo', 'aprobar', 'actualizar hogar'],
    matchNeedles: ['actualizar el hogar', 'tu hogar con netflix', 'si, la envie yo', 'si la envie yo', 'aprobar'],
    subjectNeedles: ['actualizar tu hogar', 'actualizar hogar'],
  },
}

const foldText = (value: string | null | undefined) =>
  (value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()

const normalizeSpaces = (value: string) => value.replace(/\s+/g, ' ').trim()

const decodeHtml = (value: string) =>
  value
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')

const stripHtmlLoose = (value: string) =>
  normalizeSpaces(
    value
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
  )

const looksLikeActionUrl = (value: string) => {
  if (!/^https?:\/\//i.test(value)) return false
  if (/\.(woff2?|ttf|otf|eot|css|svg|png|jpe?g|gif|webp)(\?|#|$)/i.test(value)) return false
  return true
}

const extractAnchors = (html: string) => {
  const results: Array<{ href: string; label: string }> = []
  const pattern = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi
  let match: RegExpExecArray | null = null
  while ((match = pattern.exec(html)) !== null) {
    const href = decodeHtml(match[1] || '').trim()
    const label = normalizeSpaces(stripHtmlLoose(match[2] || ''))
    if (!href) continue
    results.push({ href, label })
  }
  return results
}

const extractTextUrls = (text: string) => {
  const results: string[] = []
  const pattern = /https?:\/\/[^\s<>"')]+/gi
  let match: RegExpExecArray | null = null
  while ((match = pattern.exec(text)) !== null) {
    const url = match[0]?.trim()
    if (url) results.push(url)
  }
  return results
}

const includesAny = (haystack: string, needles: string[]) => needles.some(needle => haystack.includes(needle))

export function detectNetflixActionKind(params: {
  subject?: string | null
  bodyText?: string | null
  bodyHtml?: string | null
}): NetflixActionKind | null {
  const foldedSubject = foldText(params.subject)
  const foldedBody = foldText(`${params.bodyText || ''}\n${stripHtmlLoose(params.bodyHtml || '')}`)

  for (const kind of Object.keys(NETFLIX_ACTION_RULES) as NetflixActionKind[]) {
    const rule = NETFLIX_ACTION_RULES[kind]
    if (includesAny(foldedSubject, rule.subjectNeedles) || includesAny(foldedBody, rule.matchNeedles)) {
      return kind
    }
  }

  return null
}

export function extractNetflixActionLink(params: {
  kind: NetflixActionKind
  bodyHtml?: string | null
  bodyText?: string | null
}): { url: string | null; label: string | null } {
  const rule = NETFLIX_ACTION_RULES[params.kind]
  const html = params.bodyHtml || ''
  const text = params.bodyText || ''
  const anchors = extractAnchors(html)

  for (const anchor of anchors) {
    if (!looksLikeActionUrl(anchor.href)) continue
    const foldedLabel = foldText(anchor.label)
    if (includesAny(foldedLabel, rule.linkNeedles)) {
      return { url: anchor.href, label: anchor.label || rule.label }
    }
  }

  const urls = extractTextUrls(`${html}\n${text}`)
  const preferred =
    urls.find(url => /netflix/i.test(url) && looksLikeActionUrl(url)) ??
    urls.find(url => looksLikeActionUrl(url)) ??
    null

  if (!preferred) return { url: null, label: null }
  return { url: preferred, label: rule.label }
}

export function getNetflixActionPayload(params: {
  subject?: string | null
  bodyText?: string | null
  bodyHtml?: string | null
}): { kind: NetflixActionKind | null; url: string | null; label: string | null } {
  const kind = detectNetflixActionKind(params)
  if (!kind) return { kind: null, url: null, label: null }

  const action = extractNetflixActionLink({
    kind,
    bodyHtml: params.bodyHtml,
    bodyText: params.bodyText,
  })

  return {
    kind,
    url: action.url,
    label: action.label,
  }
}
