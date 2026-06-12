import { NextRequest, NextResponse } from 'next/server'
import { ImapFlow } from 'imapflow'
import { simpleParser } from 'mailparser'
import { fetchCodeflixMessages, isCodeflixConfigured } from '@/lib/codes-codeflix'
import { fetchSdnetpanelMessages, isSdnetpanelConfigured } from '@/lib/codes-sdnetpanel'
import { fetchSpotinetMessages, isSpotinetConfigured } from '@/lib/codes-spotinet'
import { getNetflixActionPayload } from '@/lib/codes-netflix-actions'
import { invokeDirectTelegramFlow } from '@/lib/codes-telegram-direct'
import { isSpecialNetflixRecipient, type SpecialNetflixActionKey } from '@/lib/codes-telegram-special'

const FAST_SEARCH_TIMEOUT_MS = 20000

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

const MAX_FETCH_MESSAGES = 140
const NETFLIX_FROM_HINT = 'netflix'
const TELEGRAM_CLIENT_SEARCH_TIMEOUT_MS = 90000

type ClienteKind = 'travel' | 'household'

type ClienteMailResult = {
  id: string
  subject: string
  from: string
  receivedAt: string | null
  actionUrl: string | null
  actionLabel: string | null
  snippet: string
  bodyHtml: string
  bodyText: string
}

const KIND_RULES: Record<
  ClienteKind,
  {
    title: string
    subjectPatterns: RegExp[]
    bodyPatterns: RegExp[]
    linkLabels: RegExp[]
  }
> = {
  travel: {
    title: 'Estoy de viaje',
    subjectPatterns: [/codigo de acceso temporal/i, /código de acceso temporal/i],
    bodyPatterns: [/acceso temporal/i, /obtener codigo/i, /obtener código/i, /durante viajes/i],
    linkLabels: [/obtener codigo/i, /obtener código/i],
  },
  household: {
    title: 'Actualizar hogar',
    subjectPatterns: [/actualizar tu hogar/i, /actualizar hogar/i],
    bodyPatterns: [/actualizar el hogar/i, /tu hogar con netflix/i, /si, la envie yo/i, /sí, la envié yo/i],
    linkLabels: [/si, la envie yo/i, /sí, la envié yo/i, /aprobar/i],
  },
}

function normalizeRecipient(rawValue: string) {
  return rawValue.trim().toLowerCase()
}

function ensureRecipient(rawValue: string) {
  const recipient = normalizeRecipient(rawValue)
  if (!recipient || !recipient.includes('@')) {
    throw new Error('Ingresa un correo valido.')
  }
  return recipient
}

function toText(value: unknown) {
  return typeof value === 'string' ? value : ''
}

function normalizeSpaces(value: string) {
  return value.replace(/\s+/g, ' ').trim()
}

function readAddressText(value: unknown): string {
  if (!value) return ''
  if (typeof value === 'string') return value
  if (Array.isArray(value)) {
    return value.map(item => readAddressText(item)).filter(Boolean).join(', ')
  }
  if (typeof value === 'object') {
    const record = value as {
      text?: unknown
      value?: Array<{ address?: string; name?: string }>
      toString?: () => string
    }

    if (typeof record.text === 'string') {
      return record.text
    }

    if (Array.isArray(record.value)) {
      return record.value
        .map(item => item.address || item.name || '')
        .filter(Boolean)
        .join(', ')
    }

    if (typeof record.toString === 'function') {
      return record.toString()
    }
  }
  return ''
}

function stripHtml(value: string) {
  return normalizeSpaces(
    value
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
  )
}

function decodeHtml(value: string) {
  return value
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
}

function sanitizeDisplayHtml(value: string) {
  const bodyMatch = value.match(/<body[^>]*>([\s\S]*?)<\/body>/i)
  const baseHtml = bodyMatch?.[1] ?? value

  return baseHtml
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<link\b[^>]*>/gi, '')
    .replace(/<meta\b[^>]*>/gi, '')
    .replace(/<base\b[^>]*>/gi, '')
    .replace(/\son\w+\s*=\s*(['"]).*?\1/gi, '')
    .replace(/\son\w+\s*=\s*[^ >]+/gi, '')
    .replace(/href\s*=\s*(['"])\s*javascript:[^'"]*\1/gi, 'href="#"')
    .replace(/src\s*=\s*(['"])\s*javascript:[^'"]*\1/gi, 'src=""')
    .trim()
}

function looksLikeActionUrl(value: string) {
  if (!/^https?:\/\//i.test(value)) return false
  if (/\.(woff2?|ttf|otf|eot|css|svg|png|jpe?g|gif|webp)(\?|#|$)/i.test(value)) return false
  return true
}

function extractAnchors(html: string) {
  const results: Array<{ href: string; label: string }> = []
  const pattern = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi
  let match: RegExpExecArray | null = null
  while ((match = pattern.exec(html)) !== null) {
    const href = decodeHtml(match[1] || '').trim()
    const label = normalizeSpaces(stripHtml(match[2] || ''))
    if (!href) continue
    results.push({ href, label })
  }
  return results
}

function extractTextUrls(text: string) {
  const results: string[] = []
  const pattern = /https?:\/\/[^\s<>"')]+/gi
  let match: RegExpExecArray | null = null
  while ((match = pattern.exec(text)) !== null) {
    const url = match[0]?.trim()
    if (url) results.push(url)
  }
  return results
}

function pickActionLink(kind: ClienteKind, html: string, text: string) {
  const rules = KIND_RULES[kind]
  const anchors = extractAnchors(html)
  for (const anchor of anchors) {
    if (rules.linkLabels.some(pattern => pattern.test(anchor.label))) {
      return {
        url: anchor.href,
        label: anchor.label || rules.title,
      }
    }
  }

  const urls = extractTextUrls(`${html}\n${text}`)
  const preferred =
    urls.find(url => /netflix/i.test(url) && looksLikeActionUrl(url)) ??
    urls.find(url => looksLikeActionUrl(url)) ??
    null
  if (!preferred) return { url: null, label: null }

  return {
    url: preferred,
    label: kind === 'travel' ? 'Obtener código' : 'Actualizar hogar',
  }
}

function matchesKind(kind: ClienteKind, subject: string, text: string) {
  const rules = KIND_RULES[kind]
  const haystack = `${subject}\n${text}`
  const subjectMatch = rules.subjectPatterns.some(pattern => pattern.test(subject))
  const bodyMatch = rules.bodyPatterns.some(pattern => pattern.test(haystack))
  return subjectMatch || bodyMatch
}

function buildSnippet(text: string) {
  const clean = normalizeSpaces(text)
  if (!clean) return 'Sin vista previa.'
  return clean.length > 220 ? `${clean.slice(0, 220).trim()}...` : clean
}

function extractFirstUrl(text: string) {
  return text.match(/https?:\/\/[^\s<>"')]+/i)?.[0] ?? null
}

async function readTelegramClientMails(recipient: string) {
  const grouped: Record<ClienteKind, ClienteMailResult[]> = {
    travel: [],
    household: [],
  }

  if (!isSpecialNetflixRecipient(recipient)) return grouped

  const actions: Array<{ action: SpecialNetflixActionKey; kind: ClienteKind; title: string }> = [
    { action: 'access-temporary-link', kind: 'travel', title: KIND_RULES.travel.title },
    { action: 'update-household-link', kind: 'household', title: KIND_RULES.household.title },
  ]

  const settled = await Promise.allSettled(
    actions.map(async item => {
      const result = await invokeDirectTelegramFlow({
        action: item.action,
        recipient,
      })
      const actionUrl = extractFirstUrl(result.message)

      return {
        item,
        result,
        actionUrl,
      }
    })
  )

  const failed = settled.filter((result): result is PromiseRejectedResult => result.status === 'rejected')

  for (const result of settled) {
    if (result.status !== 'fulfilled') continue

    const { actionUrl, item, result: telegramResult } = result.value
    grouped[item.kind].push({
      id: `${item.kind}-telegram-${telegramResult.source_message_id}`,
      subject: item.title,
      from: telegramResult.bot_username || 'Telegram',
      receivedAt: telegramResult.received_at,
      actionUrl,
      actionLabel: actionUrl ? item.title : null,
      snippet: buildSnippet(telegramResult.message),
      bodyHtml: actionUrl
        ? `<p>${item.title}</p><p><a href="${actionUrl}" target="_blank" rel="noopener noreferrer">${item.title}</a></p>`
        : `<p>${telegramResult.message}</p>`,
      bodyText: telegramResult.message,
    })
  }

  if (grouped.travel.length === 0 && grouped.household.length === 0 && failed.length > 0) {
    const firstError = failed[0].reason
    throw firstError instanceof Error ? firstError : new Error('Telegram no pudo completar la consulta.')
  }

  return grouped
}

async function readNetflixClientMails(recipient: string) {
  const host = toText(process.env.CODES_IMAP_HOST || process.env.IMAP_HOST)
  const port = Number(process.env.CODES_IMAP_PORT || process.env.IMAP_PORT || 993)
  const user = toText(process.env.CODES_IMAP_USER || process.env.IMAP_USER)
  const password = toText(process.env.CODES_IMAP_PASSWORD || process.env.IMAP_PASSWORD)
  const secure = String(process.env.CODES_IMAP_TLS || process.env.IMAP_TLS || 'true').toLowerCase() !== 'false'

  if (!host || !user || !password) {
    throw new Error('Faltan credenciales IMAP para leer correos Netflix.')
  }

  const client = new ImapFlow({
    host,
    port,
    secure,
    auth: { user, pass: password },
  })

  const grouped: Record<ClienteKind, ClienteMailResult[]> = {
    travel: [],
    household: [],
  }

  try {
    await client.connect()
    await client.mailboxOpen('INBOX')

    const totalMessages = Math.max(
      0,
      client.mailbox && typeof client.mailbox === 'object' && 'exists' in client.mailbox ? client.mailbox.exists : 0
    )
    const startSeq = Math.max(1, totalMessages - MAX_FETCH_MESSAGES + 1)
    const recentSequences = Array.from(
      { length: Math.max(0, totalMessages - startSeq + 1) },
      (_, index) => startSeq + index
    )
    let forwardedSequences: number[] = []

    try {
      const matches = await client.search({
        or: [
          { header: { 'x-forwarded-for': recipient } },
          { header: { 'x-forwarded-to': recipient } },
          { header: { 'x-original-to': recipient } },
          { header: { 'x-envelope-to': recipient } },
          { header: { 'resent-to': recipient } },
          { header: { 'apparently-to': recipient } },
        ],
      })
      forwardedSequences = Array.isArray(matches) ? matches.slice(-MAX_FETCH_MESSAGES) : []
    } catch {
      forwardedSequences = []
    }

    const fetchRange =
      totalMessages > 0
        ? Array.from(new Set([...recentSequences, ...forwardedSequences])).sort((a, b) => a - b)
        : '1:*'

    const rows: Array<{
      envelopeFrom: string
      parsedTo: string
      deliveredTo: string
      forwardedFor: string
      forwardedTo: string
      originalTo: string
      envelopeTo: string
      resentTo: string
      apparentlyTo: string
      subject: string
      text: string
      html: string
      receivedAt: string | null
      id: string
    }> = []

    for await (const message of client.fetch(fetchRange, {
      uid: true,
      source: true,
      envelope: true,
      internalDate: true,
    })) {
      const source = message.source ?? Buffer.from('')
      const parsed = await simpleParser(source)
      const subject = toText(parsed.subject)
      const html = sanitizeDisplayHtml(toText(parsed.html))
      const text = toText(parsed.text)
      const parsedTo = normalizeSpaces(readAddressText(parsed.to)).toLowerCase()
      const deliveredTo = normalizeSpaces(toText(parsed.headers.get('delivered-to'))).toLowerCase()
      const forwardedFor = normalizeSpaces(toText(parsed.headers.get('x-forwarded-for'))).toLowerCase()
      const forwardedTo = normalizeSpaces(toText(parsed.headers.get('x-forwarded-to'))).toLowerCase()
      const originalTo = normalizeSpaces(toText(parsed.headers.get('x-original-to'))).toLowerCase()
      const envelopeTo = normalizeSpaces(toText(parsed.headers.get('x-envelope-to'))).toLowerCase()
      const resentTo = normalizeSpaces(toText(parsed.headers.get('resent-to'))).toLowerCase()
      const apparentlyTo = normalizeSpaces(toText(parsed.headers.get('apparently-to'))).toLowerCase()
      const envelopeFrom = normalizeSpaces(
        readAddressText(parsed.from) || message.envelope?.from?.map(item => item.address || item.name || '').join(' ') || ''
      ).toLowerCase()

      rows.push({
        envelopeFrom,
        parsedTo,
        deliveredTo,
        forwardedFor,
        forwardedTo,
        originalTo,
        envelopeTo,
        resentTo,
        apparentlyTo,
        subject,
        text,
        html,
        receivedAt:
          parsed.date?.toISOString?.() ??
          (message.internalDate instanceof Date ? message.internalDate.toISOString() : null),
        id: String(message.uid || subject || Math.random()),
      })
    }

    rows.sort((a, b) => {
      const aTime = a.receivedAt ? new Date(a.receivedAt).getTime() : 0
      const bTime = b.receivedAt ? new Date(b.receivedAt).getTime() : 0
      return bTime - aTime
    })

    for (const row of rows) {
      const destinationText = [
        row.parsedTo,
        row.deliveredTo,
        row.forwardedFor,
        row.forwardedTo,
        row.originalTo,
        row.envelopeTo,
        row.resentTo,
        row.apparentlyTo,
      ].join('\n')
      if (!destinationText.includes(recipient)) continue
      if (!row.envelopeFrom.includes(NETFLIX_FROM_HINT)) continue

      const mergedText = `${row.subject}\n${stripHtml(row.html)}\n${row.text}`
      for (const kind of Object.keys(KIND_RULES) as ClienteKind[]) {
        if (!matchesKind(kind, row.subject, mergedText)) continue
        const action = pickActionLink(kind, row.html, `${row.subject}\n${row.text}`)
        grouped[kind].push({
          id: `${kind}-${row.id}`,
          subject: row.subject || KIND_RULES[kind].title,
          from: row.envelopeFrom,
          receivedAt: row.receivedAt,
          actionUrl: action.url,
          actionLabel: action.label,
          snippet: buildSnippet(mergedText),
          bodyHtml: row.html,
          bodyText: row.text || mergedText,
        })
      }
    }

    return grouped
  } finally {
    await client.logout().catch(() => undefined)
  }
}

async function readSdnetpanelClientMails(recipient: string) {
  const grouped: Record<ClienteKind, ClienteMailResult[]> = {
    travel: [],
    household: [],
  }

  if (!isSdnetpanelConfigured()) return grouped

  const result = await fetchSdnetpanelMessages({
    platform: 'netflix',
    recipient,
  })

  for (const message of result.messages) {
    const action = getNetflixActionPayload({
      subject: message.subject,
      bodyText: message.bodyText,
      bodyHtml: message.bodyHtml,
    })
    const kind = action.kind === 'travel' || action.kind === 'household' ? action.kind : null
    if (!kind) continue

    grouped[kind].push({
      id: `${kind}-${message.messageId}`,
      subject: message.subject || KIND_RULES[kind].title,
      from: message.from,
      receivedAt: message.date.toISOString(),
      actionUrl: action.url,
      actionLabel: action.label || KIND_RULES[kind].title,
      snippet: buildSnippet(`${message.subject}\n${message.bodyText}`),
      bodyHtml: message.bodyHtml,
      bodyText: message.bodyText,
    })
  }

  return grouped
}

async function readCodeflixClientMails(recipient: string) {
  const grouped: Record<ClienteKind, ClienteMailResult[]> = {
    travel: [],
    household: [],
  }

  if (!isCodeflixConfigured()) return grouped

  const result = await fetchCodeflixMessages({
    platform: 'netflix',
    recipient,
  })

  for (const message of result.messages) {
    const action = getNetflixActionPayload({
      subject: message.subject,
      bodyText: message.bodyText,
      bodyHtml: message.bodyHtml,
    })
    const kind = action.kind === 'travel' || action.kind === 'household' ? action.kind : null
    if (!kind) continue

    grouped[kind].push({
      id: `${kind}-${message.messageId}`,
      subject: message.subject || KIND_RULES[kind].title,
      from: message.from,
      receivedAt: message.date.toISOString(),
      actionUrl: action.url,
      actionLabel: action.label || KIND_RULES[kind].title,
      snippet: buildSnippet(`${message.subject}\n${message.bodyText}`),
      bodyHtml: message.bodyHtml,
      bodyText: message.bodyText,
    })
  }

  return grouped
}

async function readSpotinetClientMails(recipient: string) {
  const grouped: Record<ClienteKind, ClienteMailResult[]> = {
    travel: [],
    household: [],
  }

  if (!isSpotinetConfigured()) return grouped

  const result = await fetchSpotinetMessages({
    platform: 'netflix',
    recipient,
  })

  for (const message of result.messages) {
    const action = getNetflixActionPayload({
      subject: message.subject,
      bodyText: message.bodyText,
      bodyHtml: message.bodyHtml,
    })
    const isCombinedHomeOrTravel = /actualizar hogar|estoy de viaje|acceso temporal/i.test(
      `${message.subject}\n${message.variantLabel}\n${message.bodyText}`
    )
    const kinds: ClienteKind[] = isCombinedHomeOrTravel
      ? ['travel', 'household']
      : action.kind === 'travel' || action.kind === 'household'
        ? [action.kind]
        : []

    for (const kind of kinds) {
      grouped[kind].push({
        id: `${kind}-${message.messageId}`,
        subject: message.subject || KIND_RULES[kind].title,
        from: message.from,
        receivedAt: message.date.toISOString(),
        actionUrl: action.url,
        actionLabel: action.label || KIND_RULES[kind].title,
        snippet: buildSnippet(`${message.subject}\n${message.bodyText}`),
        bodyHtml: message.bodyHtml,
        bodyText: message.bodyText,
      })
    }
  }

  return grouped
}

export async function GET(request: NextRequest) {
  try {
    const recipient = ensureRecipient(request.nextUrl.searchParams.get('recipient') || '')
    if (!recipient) {
      return NextResponse.json({ error: 'Ingresa un correo valido.' }, { status: 400 })
    }

    const grouped: Record<ClienteKind, ClienteMailResult[]> = {
      travel: [],
      household: [],
    }
    const errors: string[] = []
    const usesTelegram = isSpecialNetflixRecipient(recipient)
    const loaders = usesTelegram
      ? [readTelegramClientMails]
      : [
          readNetflixClientMails,
          readCodeflixClientMails,
          readSdnetpanelClientMails,
          readSpotinetClientMails,
        ]
    const pending = new Map(
      loaders.map((loader, index) => [
        index,
        loader(recipient).then(
          value => ({ index, status: 'fulfilled' as const, value }),
          reason => ({ index, status: 'rejected' as const, reason })
        ),
      ])
    )
    let searchTimeoutId: ReturnType<typeof setTimeout> | null = null
    const searchTimeout = new Promise<{ status: 'timeout' }>(resolve => {
      searchTimeoutId = setTimeout(
        () => resolve({ status: 'timeout' }),
        usesTelegram ? TELEGRAM_CLIENT_SEARCH_TIMEOUT_MS : FAST_SEARCH_TIMEOUT_MS
      )
    })

    while (pending.size > 0) {
      const result = await Promise.race([...pending.values(), searchTimeout])
      if (result.status === 'timeout') break

      pending.delete(result.index)

      if (result.status === 'rejected') {
        errors.push(result.reason instanceof Error ? result.reason.message : 'Fuente no disponible.')
        continue
      }

      grouped.travel.push(...result.value.travel)
      grouped.household.push(...result.value.household)
      if (result.value.travel.length > 0 || result.value.household.length > 0) break
    }

    if (searchTimeoutId) clearTimeout(searchTimeoutId)

    if (grouped.travel.length === 0 && grouped.household.length === 0 && errors.length > 0) {
      throw new Error(errors[0])
    }

    return NextResponse.json({
      recipient,
      travel: grouped.travel
        .sort((a, b) => new Date(b.receivedAt || 0).getTime() - new Date(a.receivedAt || 0).getTime())
        .slice(0, 8),
      household: grouped.household
        .sort((a, b) => new Date(b.receivedAt || 0).getTime() - new Date(a.receivedAt || 0).getTime())
        .slice(0, 8),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'No se pudieron leer los correos.'
    const status =
      /ingresa un correo/i.test(message)
        ? 400
        : 500
    return NextResponse.json({ error: message }, { status })
  }
}
