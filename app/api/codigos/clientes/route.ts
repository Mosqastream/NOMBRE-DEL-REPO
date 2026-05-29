import { NextRequest, NextResponse } from 'next/server'
import { ImapFlow } from 'imapflow'
import { simpleParser } from 'mailparser'
import { fetchSdnetpanelMessages, isSdnetpanelConfigured } from '@/lib/codes-sdnetpanel'
import { getNetflixActionPayload } from '@/lib/codes-netflix-actions'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_FETCH_MESSAGES = 140
const NETFLIX_FROM_HINT = 'netflix'

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
    const fetchRange = totalMessages > 0 ? `${startSeq}:${totalMessages}` : '1:*'

    const rows: Array<{
      envelopeFrom: string
      parsedTo: string
      deliveredTo: string
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
      const envelopeFrom = normalizeSpaces(
        readAddressText(parsed.from) || message.envelope?.from?.map(item => item.address || item.name || '').join(' ') || ''
      ).toLowerCase()

      rows.push({
        envelopeFrom,
        parsedTo,
        deliveredTo,
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
      const destinationText = `${row.parsedTo}\n${row.deliveredTo}`
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

    for (const loader of [readNetflixClientMails, readSdnetpanelClientMails]) {
      try {
        const result = await loader(recipient)
        grouped.travel.push(...result.travel)
        grouped.household.push(...result.household)
      } catch (error) {
        errors.push(error instanceof Error ? error.message : 'Fuente no disponible.')
      }
    }

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
