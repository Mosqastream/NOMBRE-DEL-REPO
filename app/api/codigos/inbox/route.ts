import { NextRequest, NextResponse } from 'next/server'
import { unstable_noStore as noStore } from 'next/cache'
import { ImapFlow } from 'imapflow'
import { simpleParser } from 'mailparser'
import { CodesAccessError, enforceCodesRecipientAccess } from '@/lib/codes-access'
import { fetchCodeflixMessages, isCodeflixConfigured, type CodeflixMessage } from '@/lib/codes-codeflix'
import { stripHtml } from '@/lib/lemon-parser'
import { fetchGlowpremMessages, isGlowpremConfigured, type GlowpremMessage } from '@/lib/codes-glowprem'
import { fetchGoatstreamMessages, isGoatstreamConfigured, type GoatstreamMessage } from '@/lib/codes-goatstream'
import { getNetflixActionPayload } from '@/lib/codes-netflix-actions'
import { fetchSdnetpanelMessages, isSdnetpanelConfigured, type SdnetpanelMessage } from '@/lib/codes-sdnetpanel'
import { fetchSpotinetMessages, isSpotinetConfigured, type SpotinetMessage } from '@/lib/codes-spotinet'
import { detectCodePlatform, type CodePlatformKey, type CodePlatformMatch } from '@/lib/codes-shared'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60
const FAST_SEARCH_TIMEOUT_MS = 20000

type ImapMessage = {
  uid: number
  subject: string
  from: string
  to: string[]
  date: Date
  bodyText: string
  bodyHtml: string
  messageId: string | null
  platform: CodePlatformMatch
  source: 'imap'
  variantLabel?: string
}

type CodeMessage = ImapMessage | CodeflixMessage | GlowpremMessage | GoatstreamMessage | SdnetpanelMessage | SpotinetMessage

type CodeSourceResult = {
  mailbox?: string
  messages: CodeMessage[]
  source: string
  totalScanned: number
  variantLabels?: string[]
}

type LegacyImapConfig = {
  imapHost: string
  imapPassword: string
  imapPort: number
  imapTls: boolean
  imapUser: string
  mailbox: string
  maxMessages: number
}

const normalizeHeader = (value: string | null | undefined) => (value || '').trim()
const normalizeEmail = (value: string) => value.trim().toLowerCase()
const extractEmails = (value: string | null | undefined): string[] =>
  value ? value.toLowerCase().match(/[\w.+-]+@[\w.-]+\.[\w.-]+/g) ?? [] : []

const collectHeaderEmails = (headers: Array<string | undefined>) => {
  const result = new Set<string>()
  for (const header of headers) {
    extractEmails(header).forEach(email => result.add(normalizeEmail(email)))
  }
  return result
}

const parseEnvelopeAddresses = (items: Array<{ address?: string; name?: string }> | undefined) => {
  if (!items) return []
  return items
    .map(item => normalizeEmail(item.address || item.name || ''))
    .filter(Boolean)
}

const headerValueToText = (value: unknown): string => {
  if (!value) return ''
  if (typeof value === 'string') return value
  if (Array.isArray(value)) {
    return value.map(item => headerValueToText(item)).filter(Boolean).join(', ')
  }
  if (typeof value === 'object') {
    const maybeRecord = value as {
      text?: unknown
      value?: Array<{ address?: string; name?: string }>
      toString?: () => string
    }

    if (typeof maybeRecord.text === 'string') {
      return maybeRecord.text
    }

    if (Array.isArray(maybeRecord.value)) {
      return maybeRecord.value
        .map(item => item.address || item.name || '')
        .filter(Boolean)
        .join(', ')
    }

    if (typeof maybeRecord.toString === 'function') {
      return maybeRecord.toString()
    }
  }
  return ''
}

const addressValueToList = (value: unknown): Array<{ address?: string; name?: string }> => {
  if (!value) return []
  if (Array.isArray(value)) {
    return value.filter(item => Boolean(item) && typeof item === 'object') as Array<{
      address?: string
      name?: string
    }>
  }

  if (typeof value === 'object') {
    const maybeRecord = value as {
      value?: Array<{ address?: string; name?: string }>
    }

    if (Array.isArray(maybeRecord.value)) {
      return maybeRecord.value
    }
  }

  return []
}

const getBodyText = (parsed: Awaited<ReturnType<typeof simpleParser>>, rawSource: string) => {
  if (parsed.text) return parsed.text.trim()
  if (parsed.html) {
    const htmlText = String(parsed.html)
    return stripHtml(htmlText)
  }
  if (rawSource) return stripHtml(rawSource)
  return ''
}

const sanitizeHtml = (html: string) =>
  html
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, '')
    .replace(/\son\w+\s*=\s*(['"]).*?\1/gi, '')
    .replace(/\son\w+\s*=\s*[^ >]+/gi, '')
    .replace(/href\s*=\s*(['"])\s*javascript:[^'"]*\1/gi, 'href="#"')
    .trim()

const getBodyHtml = (parsed: Awaited<ReturnType<typeof simpleParser>>) => {
  if (!parsed.html) return ''
  const htmlText = String(parsed.html)
  return sanitizeHtml(htmlText)
}

const toPositiveInt = (value: string | undefined, fallback: number) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback
}

const getLegacyImapConfig = (): LegacyImapConfig | null => {
  const imapHost = normalizeHeader(process.env.CODES_IMAP_HOST || process.env.IMAP_HOST)
  const imapUser = normalizeHeader(process.env.CODES_IMAP_USER || process.env.IMAP_USER)
  const imapPassword = normalizeHeader(process.env.CODES_IMAP_PASSWORD || process.env.IMAP_PASSWORD)
  if (!imapHost || !imapUser || !imapPassword) return null

  return {
    imapHost,
    imapPassword,
    imapPort: toPositiveInt(process.env.CODES_IMAP_PORT || process.env.IMAP_PORT, 993),
    imapTls: (process.env.CODES_IMAP_TLS || process.env.IMAP_TLS) !== 'false',
    imapUser,
    mailbox: normalizeHeader(process.env.CODES_IMAP_MAILBOX) || 'INBOX',
    maxMessages: toPositiveInt(process.env.CODES_IMAP_MAX_MESSAGES, 50),
  }
}

const getAvailableSourcesForPlatform = (params: {
  platform: CodePlatformKey
  hasImap: boolean
  hasCodeflix: boolean
  hasGlowprem: boolean
  hasGoatstream: boolean
  hasSdnetpanel: boolean
  hasSpotinet: boolean
}) => {
  if (params.platform === 'netflix') {
    return [
      params.hasImap ? 'IMAP' : null,
      params.hasCodeflix ? 'Codeflix' : null,
      params.hasGoatstream ? 'Goatstream' : null,
      params.hasSdnetpanel ? 'SDNetPanel' : null,
      params.hasSpotinet ? 'Spotinet' : null,
    ].filter(Boolean) as string[]
  }

  if (params.platform === 'disney') {
    return [
      params.hasImap ? 'IMAP' : null,
      params.hasGlowprem ? 'Glowprem' : null,
      params.hasGoatstream ? 'Goatstream' : null,
      params.hasSdnetpanel ? 'SDNetPanel' : null,
    ].filter(Boolean) as string[]
  }

  return [
    params.hasImap ? 'IMAP' : null,
    params.hasSdnetpanel ? 'SDNetPanel' : null,
  ].filter(Boolean) as string[]
}

const getImapClient = (config: LegacyImapConfig) =>
  new ImapFlow({
    host: config.imapHost,
    port: config.imapPort,
    secure: config.imapTls,
    auth: {
      user: config.imapUser,
      pass: config.imapPassword,
    },
  })

const findForwardedMessageSequences = async (client: ImapFlow, recipient: string, limit: number) => {
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

    return Array.isArray(matches) ? matches.slice(-limit) : []
  } catch {
    return []
  }
}

const fetchMessages = async (
  client: ImapFlow,
  mailboxName: string,
  maxMessages: number,
  recipient: string
) => {
  const safeMaxMessages = Number.isFinite(maxMessages) ? Math.max(1, maxMessages) : 50
  const lock = await client.getMailboxLock(mailboxName)

  try {
    const status = await client.status(mailboxName, { messages: true })
    const total =
      status && typeof status.messages === 'number'
        ? status.messages
        : client.mailbox && typeof client.mailbox.exists === 'number'
          ? client.mailbox.exists
          : 0

    if (total <= 0) {
      return { mailbox: mailboxName, messages: [] as ImapMessage[] }
    }

    const start = Math.max(1, total - safeMaxMessages + 1)
    const recentSequences = Array.from({ length: total - start + 1 }, (_, index) => start + index)
    const forwardedSequences = await findForwardedMessageSequences(client, recipient, safeMaxMessages)
    const sequence = Array.from(new Set([...recentSequences, ...forwardedSequences])).sort((a, b) => a - b)
    const messages: ImapMessage[] = []

    for await (const msg of client.fetch(sequence, {
      uid: false,
      envelope: true,
      source: true,
      internalDate: true,
    })) {
      const rawSource = msg.source ?? ''
      const rawText = typeof rawSource === 'string' ? rawSource : rawSource.toString('utf8')
      const parsed = await simpleParser(rawSource)
      const subject = normalizeHeader(parsed.subject || msg.envelope?.subject || '')
      const from = normalizeHeader(
        headerValueToText(parsed.from) || msg.envelope?.from?.map(item => item.address || '').join(', ')
      )
      const date =
        parsed.date instanceof Date
          ? parsed.date
          : msg.internalDate instanceof Date
            ? msg.internalDate
            : msg.envelope?.date instanceof Date
              ? msg.envelope.date
              : new Date()
      const bodyText = getBodyText(parsed, rawText)
      const bodyHtml = getBodyHtml(parsed)
      const messageId = normalizeHeader(parsed.messageId || msg.envelope?.messageId || '') || null

      const headerTo = parsed.headers.get('to')
      const deliveredTo = parsed.headers.get('delivered-to')
      const originalTo = parsed.headers.get('x-original-to')
      const envelopeTo = parsed.headers.get('x-envelope-to')
      const forwardedFor = parsed.headers.get('x-forwarded-for')
      const forwardedTo = parsed.headers.get('x-forwarded-to')
      const resentTo = parsed.headers.get('resent-to')
      const apparentlyTo = parsed.headers.get('apparently-to')

      const recipients = new Set<string>()
      const toList = addressValueToList(parsed.to)
      const ccList = addressValueToList(parsed.cc)

      parseEnvelopeAddresses(msg.envelope?.to).forEach(email => recipients.add(email))
      parseEnvelopeAddresses(toList).forEach(email => recipients.add(email))
      parseEnvelopeAddresses(ccList).forEach(email => recipients.add(email))
      collectHeaderEmails([
        headerValueToText(headerTo),
        headerValueToText(deliveredTo),
        headerValueToText(originalTo),
        headerValueToText(envelopeTo),
        headerValueToText(forwardedFor),
        headerValueToText(forwardedTo),
        headerValueToText(resentTo),
        headerValueToText(apparentlyTo),
      ]).forEach(email => recipients.add(email))

      messages.push({
        uid: msg.uid,
        subject,
        from,
        to: Array.from(recipients),
        date,
        bodyText,
        bodyHtml,
        messageId,
        platform: detectCodePlatform({ from, subject, bodyText }),
        source: 'imap',
      })
    }

    return { mailbox: mailboxName, messages }
  } finally {
    lock.release()
  }
}

const fetchImapMessages = async (config: LegacyImapConfig, recipient: string) => {
  let imapClient: ImapFlow | null = null

  try {
    imapClient = getImapClient(config)
    await imapClient.connect()
    const result = await fetchMessages(imapClient, config.mailbox, config.maxMessages, recipient)
    await imapClient.logout()
    return result
  } catch (error) {
    if (imapClient) {
      try {
        await imapClient.logout()
      } catch {
        // ignore
      }
    }
    throw error
  }
}

const isNetflixRecipient = (recipient: string) => {
  const local = recipient.split('@')[0]?.toLowerCase() || ''
  return local.startsWith('netflix')
}

const isCryxteamRecipient = (recipient: string) => {
  const domain = recipient.split('@')[1]?.toLowerCase() || ''
  return domain === 'cryxteam.com'
}

const shouldHideNetflixCode = (text: string) => {
  const normalized = text.toLowerCase()
  if (/confirma el cambio de cuenta con este c\S*digo/.test(normalized)) return true
  return /\b\d{6}\b/.test(text)
}

const dedupeMessages = (messages: CodeMessage[]) => {
  const seen = new Set<string>()

  return messages.filter(message => {
    const key =
      message.messageId ||
      `${message.source}:${message.uid}:${message.platform}:${message.from}:${message.date.toISOString()}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export async function GET(request: NextRequest) {
  noStore()

  const recipient = normalizeEmail(request.nextUrl.searchParams.get('recipient') || '')
  if (!recipient || !recipient.includes('@')) {
    return NextResponse.json({ error: 'recipient es requerido' }, { status: 400 })
  }

  const requestedPlatform = (request.nextUrl.searchParams.get('platform') || '').trim().toLowerCase()
  const selectedPlatform: CodePlatformKey | null =
    requestedPlatform === 'netflix' || requestedPlatform === 'disney' || requestedPlatform === 'hbo'
      ? requestedPlatform
      : null

  if (!selectedPlatform) {
    return NextResponse.json({ error: 'platform es requerido' }, { status: 400 })
  }

  const imapConfig = getLegacyImapConfig()
  const glowpremEnabled = selectedPlatform === 'disney' && isGlowpremConfigured()
  const codeflixEnabled = selectedPlatform === 'netflix' && isCodeflixConfigured()
  const goatstreamEnabled = isGoatstreamConfigured()
  const sdnetpanelEnabled = isSdnetpanelConfigured()
  const spotinetEnabled = selectedPlatform === 'netflix' && isSpotinetConfigured()
  const availableSources = getAvailableSourcesForPlatform({
    platform: selectedPlatform,
    hasImap: Boolean(imapConfig),
    hasCodeflix: codeflixEnabled,
    hasGlowprem: glowpremEnabled,
    hasGoatstream: goatstreamEnabled,
    hasSdnetpanel: sdnetpanelEnabled,
    hasSpotinet: spotinetEnabled,
  })

  if (availableSources.length === 0) {
    return NextResponse.json(
      {
        error:
          selectedPlatform === 'netflix'
            ? 'No hay fuentes de codigos para Netflix. Configura IMAP, Codeflix, Goatstream, SDNetPanel o Spotinet en .env.local.'
            : selectedPlatform === 'disney'
              ? 'No hay fuentes de codigos para Disney+. Configura IMAP, Glowprem, Goatstream o SDNetPanel en .env.local.'
              : 'No hay fuentes de codigos para HBO Max. Configura IMAP o SDNetPanel en .env.local.',
      },
      { status: 500 }
    )
  }

  let accessMode: Awaited<ReturnType<typeof enforceCodesRecipientAccess>>

  try {
    accessMode = await enforceCodesRecipientAccess({
      request,
      recipient,
    })
  } catch (error: unknown) {
    if (error instanceof CodesAccessError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }

    const message = error instanceof Error ? error.message : 'No se pudo validar el acceso.'
    return NextResponse.json({ error: message }, { status: 500 })
  }

  if (request.nextUrl.searchParams.get('debug') === '1' && accessMode.mode === 'owner') {
    const spotinetProbeStartedAt = Date.now()
    let spotinetProbe:
      | {
          elapsed_ms: number
          error?: string
          item_count?: number
          ok: boolean
          sample?: {
            body_text: string
            source: string
            subject: string
            variant_label: string
          } | null
          total_scanned?: number
          variants?: string[]
        }
      | null = null

    if (spotinetEnabled) {
      try {
        const result = await fetchSpotinetMessages({ platform: selectedPlatform, recipient })
        spotinetProbe = {
          elapsed_ms: Date.now() - spotinetProbeStartedAt,
          item_count: result.messages.length,
          ok: true,
          sample: result.messages[0]
            ? {
                body_text: result.messages[0].bodyText,
                source: result.messages[0].source,
                subject: result.messages[0].subject,
                variant_label: result.messages[0].variantLabel,
              }
            : null,
          total_scanned: result.totalScanned,
          variants: result.variantsScanned,
        }
      } catch (error) {
        spotinetProbe = {
          elapsed_ms: Date.now() - spotinetProbeStartedAt,
          error: error instanceof Error ? error.message : 'Spotinet fallo sin mensaje.',
          ok: false,
        }
      }
    }

    return NextResponse.json({
      available_sources: availableSources,
      flags: {
        glowprem: glowpremEnabled,
        codeflix: codeflixEnabled,
        goatstream: goatstreamEnabled,
        imap: Boolean(imapConfig),
        sdnetpanel: sdnetpanelEnabled,
        spotinet: spotinetEnabled,
      },
      env: {
        spotinetAccountsJson: Boolean(process.env.SPOTINET_ACCOUNTS_JSON),
        spotinetAccountsJsonLength: (process.env.SPOTINET_ACCOUNTS_JSON || '').length,
        spotinetBackendUrl: Boolean(process.env.SPOTINET_BACKEND_URL),
        spotinetBaseUrl: Boolean(process.env.SPOTINET_BASE_URL),
        spotinetMaxItems: Boolean(process.env.SPOTINET_MAX_ITEMS),
        spotinetPassword: Boolean(process.env.SPOTINET_PASSWORD),
        spotinetUsername: Boolean(process.env.SPOTINET_USERNAME),
      },
      spotinet_probe: spotinetProbe,
    })
  }

  const tasks: Array<Promise<CodeSourceResult>> = []

  if (imapConfig) {
    tasks.push(
      fetchImapMessages(imapConfig, recipient).then(result => ({
        mailbox: result.mailbox,
        messages: result.messages,
        source: 'imap',
        totalScanned: result.messages.length,
        variantLabels: [],
      }))
    )
  }

  if (codeflixEnabled) {
    tasks.push(
      fetchCodeflixMessages({ platform: selectedPlatform, recipient }).then(result => ({
        messages: result.messages,
        source: 'codeflix',
        totalScanned: result.totalScanned,
        variantLabels: result.variantsScanned,
      }))
    )
  }

  if (glowpremEnabled) {
    tasks.push(
      fetchGlowpremMessages({ platform: selectedPlatform, recipient }).then(result => ({
        messages: result.messages,
        source: 'glowprem',
        totalScanned: result.totalScanned,
        variantLabels: [],
      }))
    )
  }

  if (goatstreamEnabled) {
    tasks.push(
      fetchGoatstreamMessages({ platform: selectedPlatform, recipient }).then(result => ({
        messages: result.messages,
        source: 'goatstream',
        totalScanned: result.totalScanned,
        variantLabels: [],
      }))
    )
  }

  if (sdnetpanelEnabled) {
    tasks.push(
      fetchSdnetpanelMessages({ platform: selectedPlatform, recipient }).then(result => ({
        messages: result.messages,
        source: 'sdnetpanel',
        totalScanned: result.totalScanned,
        variantLabels: result.variantsScanned,
      }))
    )
  }

  if (spotinetEnabled) {
    tasks.push(
      fetchSpotinetMessages({ platform: selectedPlatform, recipient }).then(result => ({
        messages: result.messages,
        source: 'spotinet',
        totalScanned: result.totalScanned,
        variantLabels: result.variantsScanned,
      }))
    )
  }

  const isUsefulMessage = (message: CodeMessage) => {
    const recipientMatches =
      message.source !== 'imap' || message.to.some(address => address === recipient)

    const shouldHideForRecipient =
      isNetflixRecipient(recipient) && !isCryxteamRecipient(recipient) && shouldHideNetflixCode(message.bodyText || '')

    return recipientMatches && !shouldHideForRecipient && message.platform === selectedPlatform
  }

  const pending = new Map(
    tasks.map((task, index) => [
      index,
      task.then(
        value => ({ index, status: 'fulfilled' as const, value }),
        reason => ({ index, status: 'rejected' as const, reason })
      ),
    ])
  )
  const successfulSources: CodeSourceResult[] = []
  const failedSources: Array<{ reason: unknown }> = []
  let searchTimeoutId: ReturnType<typeof setTimeout> | null = null
  const searchTimeout = new Promise<{ status: 'timeout' }>(resolve => {
    searchTimeoutId = setTimeout(() => resolve({ status: 'timeout' }), FAST_SEARCH_TIMEOUT_MS)
  })

  while (pending.size > 0) {
    const result = await Promise.race([...pending.values(), searchTimeout])
    if (result.status === 'timeout') break

    pending.delete(result.index)

    if (result.status === 'rejected') {
      failedSources.push(result)
      continue
    }

    successfulSources.push(result.value)
    if (result.value.messages.some(isUsefulMessage)) break
  }

  if (searchTimeoutId) clearTimeout(searchTimeoutId)

  if (successfulSources.length === 0 && failedSources.length > 0) {
    const firstError = failedSources[0].reason
    const message = firstError instanceof Error ? firstError.message : 'No se pudo leer ninguna fuente.'
    return NextResponse.json({ error: message }, { status: 502 })
  }

  const allMessages = successfulSources.flatMap(source => source.messages)
  const deduped = dedupeMessages(allMessages)
  const filtered = deduped
    .filter(isUsefulMessage)
    .sort((a, b) => b.date.getTime() - a.date.getTime())
    .slice(0, 3)
    .map(message => {
      const netflixAction =
        message.platform === 'netflix'
          ? getNetflixActionPayload({
              subject: message.subject,
              bodyText: message.bodyText,
              bodyHtml: message.bodyHtml,
            })
          : { kind: null, url: null, label: null }

      return {
        uid: message.uid,
        subject: message.subject || '(Sin asunto)',
        from: message.from || '-',
        to: message.to,
        date: message.date.toISOString(),
        body_text: message.bodyText || '',
        body_html: message.bodyHtml || '',
        message_id: message.messageId,
        platform: message.platform,
        source: message.source,
        variant_label: 'variantLabel' in message ? message.variantLabel || null : null,
        action_kind: netflixAction.kind,
        action_url: netflixAction.url,
        action_label: netflixAction.label,
      }
    })

  const mailboxLabel =
    successfulSources.length > 1
      ? 'Fuentes combinadas'
      : successfulSources[0]?.mailbox || successfulSources[0]?.source || 'INBOX'
  const totalScanned = successfulSources.reduce((sum, source) => sum + source.totalScanned, 0)
  const variantLabels = Array.from(
    new Set(successfulSources.flatMap(source => source.variantLabels || []).filter(Boolean))
  )

  return NextResponse.json({
    mailbox: mailboxLabel,
    recipient,
    total_scanned: totalScanned,
    items: filtered,
    sources: successfulSources.map(source => source.source),
    variant_labels: variantLabels,
  })
}

export async function POST(request: NextRequest) {
  return GET(request)
}
