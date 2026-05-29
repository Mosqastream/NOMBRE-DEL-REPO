'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import {
  SPECIAL_NETFLIX_ACTIONS,
  getSpecialNetflixAction,
  isSpecialNetflixRecipient,
  type SpecialNetflixActionKey,
} from '@/lib/codes-telegram-special'
import { supabase } from '@/lib/supabaseClient'
import {
  CODE_PLATFORM_META,
  CODE_PLATFORM_ORDER,
  getCodePlatformLabel,
  type CodePlatformKey,
  type CodePlatformMatch,
} from '@/lib/codes-shared'
import styles from './codigos.module.css'

type InboxItem = {
  uid: number
  subject: string
  from: string
  to: string[]
  date: string
  body_text: string
  body_html: string
  message_id: string | null
  platform: CodePlatformMatch
  source?: string
  variant_label?: string | null
  action_kind?: 'travel' | 'household' | null
  action_url?: string | null
  action_label?: string | null
}

type InboxResponse = {
  mailbox: string
  recipient: string
  total_scanned: number
  items: InboxItem[]
  error?: string
  sources?: string[]
  variant_labels?: string[]
}

type TelegramSpecialResponse = {
  action: SpecialNetflixActionKey
  action_label: string
  bot_username: string
  message: string
  platform: 'netflix'
  received_at: string
  recipient: string
  source_message_id: number
  wait_ms: number
  error?: string
}

const URL_PATTERN = /https?:\/\/[^\s]+/i

const formatDateTime = (value: string | null) => {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  return date.toLocaleString('es-PE', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

const formatTelegramDateTime = (value: string | null) => {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime()) || date.getFullYear() < 2000) return null
  return date.toLocaleString('es-PE', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

const extractFirstUrl = (value: string | null) => {
  if (!value) return null
  const match = value.match(URL_PATTERN)
  return match?.[0] || null
}

const getExternalLinkHtml = (html: string) => {
  const withBase = html.includes('<head')
    ? html.replace(/<head([^>]*)>/i, '<head$1><base target="_blank">')
    : `<base target="_blank">${html}`

  return withBase.replace(/<a\b(?![^>]*\btarget=)/gi, '<a target="_blank" rel="noreferrer noopener"')
}

const getItemKey = (item: InboxItem) => item.message_id || `${item.source || 'local'}-${item.uid}-${item.date}`

type CodigosPageProps = {
  embedded?: boolean
}

export function CodigosWorkspace({ embedded = false }: CodigosPageProps) {
  const [recipient, setRecipient] = useState('')
  const [items, setItems] = useState<InboxItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [meta, setMeta] = useState<{
    mailbox: string
    scanned: number
    fetchedAt: string
    sources: string[]
    variants: string[]
  } | null>(null)
  const [hasSearched, setHasSearched] = useState(false)
  const [selectedPlatform, setSelectedPlatform] = useState<CodePlatformKey | null>(null)
  const [selectedItemKey, setSelectedItemKey] = useState<string | null>(null)
  const [isDashboardLoggedIn, setIsDashboardLoggedIn] = useState(false)
  const [copiedActionKey, setCopiedActionKey] = useState<string | null>(null)
  const [telegramResult, setTelegramResult] = useState<TelegramSpecialResponse | null>(null)
  const [telegramActionKey, setTelegramActionKey] = useState<SpecialNetflixActionKey | null>(null)
  const [telegramRecipients, setTelegramRecipients] = useState<string[]>([])

  useEffect(() => {
    let active = true

    const readSession = async () => {
      const session = await supabase.auth.getSession()
      if (!active) return
      const token = session.data.session?.access_token
      setIsDashboardLoggedIn(Boolean(token))
      if (token) {
        void fetchTelegramRecipients(token)
      }
    }

    void readSession()

    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active) return
      const token = session?.access_token
      setIsDashboardLoggedIn(Boolean(token))
      if (token) {
        void fetchTelegramRecipients(token)
      } else {
        setTelegramRecipients([])
      }
    })

    return () => {
      active = false
      data.subscription.unsubscribe()
    }
  }, [])

  const fetchTelegramRecipients = async (token: string) => {
    try {
      const response = await fetch('/api/codigos/telegram/accounts', {
        method: 'GET',
        cache: 'no-store',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      })
      const payload = (await response.json().catch(() => ({}))) as {
        recipients?: string[]
      }
      if (response.ok) {
        setTelegramRecipients((payload.recipients || []).map(item => item.trim().toLowerCase()))
      }
    } catch {
      setTelegramRecipients([])
    }
  }

  const visibleItems = useMemo(() => {
    if (!selectedPlatform) return []

    return [...items]
      .filter(item => item.platform === selectedPlatform)
      .sort((left, right) => new Date(right.date).getTime() - new Date(left.date).getTime())
  }, [items, selectedPlatform])

  const visibleVariants = useMemo(() => {
    if (meta?.variants.length) return meta.variants
    return Array.from(new Set(visibleItems.map(item => item.variant_label).filter(Boolean)))
  }, [meta?.variants, visibleItems])

  const selectedItem = useMemo(() => {
    if (!selectedItemKey) return null
    return visibleItems.find(item => getItemKey(item) === selectedItemKey) ?? null
  }, [selectedItemKey, visibleItems])

  const normalizedRecipient = useMemo(() => recipient.trim().toLowerCase(), [recipient])
  const telegramRecipientSet = useMemo(() => new Set(telegramRecipients), [telegramRecipients])
  const isSpecialNetflixFlow =
    selectedPlatform === 'netflix' &&
    (isSpecialNetflixRecipient(normalizedRecipient) || telegramRecipientSet.has(normalizedRecipient))
  const activeTelegramAction = telegramActionKey ? getSpecialNetflixAction(telegramActionKey) : null
  const latestVisibleDate = visibleItems[0]?.date ?? null
  const platformMeta = selectedPlatform ? CODE_PLATFORM_META[selectedPlatform] : null
  const telegramResultUrl = telegramResult ? extractFirstUrl(telegramResult.message) : null
  const telegramResultDate = telegramResult ? formatTelegramDateTime(telegramResult.received_at) : null

  useEffect(() => {
    setTelegramResult(null)
    setTelegramActionKey(null)

    if (isSpecialNetflixFlow) {
      setSelectedItemKey(null)
    }
  }, [isSpecialNetflixFlow, normalizedRecipient, selectedPlatform])

  const resetSearchState = () => {
    setItems([])
    setMeta(null)
    setHasSearched(false)
    setError('')
    setSelectedItemKey(null)
    setTelegramResult(null)
    setTelegramActionKey(null)
  }

  const handlePlatformSelect = (platform: CodePlatformKey) => {
    setSelectedPlatform(platform)
    resetSearchState()
  }

  const handleBackToPlatforms = () => {
    setSelectedPlatform(null)
    setRecipient('')
    resetSearchState()
  }

  const handleFetch = async () => {
    if (!selectedPlatform) {
      setError('Selecciona una plataforma primero.')
      return
    }

    const recipientValue = recipient.trim()
    if (!recipientValue) {
      setError('Escribe un correo.')
      return
    }

    if (
      selectedPlatform === 'netflix' &&
      (isSpecialNetflixRecipient(recipientValue) || telegramRecipientSet.has(recipientValue.toLowerCase()))
    ) {
      setError('Este correo usa el flujo especial de Telegram. Elige una opcion.')
      return
    }

    setLoading(true)
    setError('')
    setHasSearched(true)
    setSelectedItemKey(null)
    setTelegramResult(null)
    setTelegramActionKey(null)

    try {
      const session = await supabase.auth.getSession()
      const token = session.data.session?.access_token

      if (!token) {
        throw new Error('Debes iniciar sesion para consultar tus correos asignados.')
      }

      const params = new URLSearchParams({
        recipient: recipientValue,
        platform: selectedPlatform,
      })

      const response = await fetch(`/api/codigos/inbox?${params.toString()}`, {
        method: 'GET',
        cache: 'no-store',
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      })

      const payload = (await response.json()) as InboxResponse
      if (!response.ok || payload.error) {
        throw new Error(payload.error || 'No se pudo leer el inbox.')
      }

      setItems(payload.items || [])
      setMeta({
        mailbox: payload.mailbox || 'INBOX',
        scanned: payload.total_scanned || 0,
        fetchedAt: new Date().toLocaleString('es-PE'),
        sources: payload.sources || [],
        variants: payload.variant_labels || [],
      })
    } catch (err: unknown) {
      setItems([])
      setMeta(null)
      setError(err instanceof Error ? err.message : 'No se pudo leer el inbox.')
    } finally {
      setLoading(false)
    }
  }

  const handleSpecialFetch = async (actionKey: SpecialNetflixActionKey) => {
    if (selectedPlatform !== 'netflix') {
      setError('Este flujo especial solo esta disponible para Netflix.')
      return
    }

    const recipientValue = recipient.trim().toLowerCase()
    if (!isSpecialNetflixRecipient(recipientValue) && !telegramRecipientSet.has(recipientValue)) {
      setError('Ingresa uno de los correos especiales para usar Telegram.')
      return
    }

    setLoading(true)
    setError('')
    setHasSearched(true)
    setSelectedItemKey(null)
    setItems([])
    setMeta(null)
    setTelegramResult(null)
    setTelegramActionKey(actionKey)

    try {
      const session = await supabase.auth.getSession()
      const token = session.data.session?.access_token

      if (!token) {
        throw new Error('Debes iniciar sesion para consultar tus correos asignados.')
      }

      const response = await fetch('/api/codigos/telegram', {
        method: 'POST',
        cache: 'no-store',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          action: actionKey,
          recipient: recipientValue,
        }),
      })

      const payload = (await response.json()) as TelegramSpecialResponse
      if (!response.ok || payload.error) {
        throw new Error(payload.error || 'No se pudo consultar Telegram.')
      }

      setTelegramResult(payload)
    } catch (err: unknown) {
      setTelegramResult(null)
      setError(err instanceof Error ? err.message : 'No se pudo consultar Telegram.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className={embedded ? styles.embeddedPage : styles.page}>
      <div className={embedded ? styles.embeddedShell : styles.shell}>
        {!selectedPlatform && (
          <section className={styles.catalogView}>
            <div className={styles.heroBlock}>
              <h1>Codigos automaticos</h1>
              <p>
                Elige la plataforma y luego ingresa el correo destino para ver los ultimos mensajes. Los
                correos con codigos de cambio de cuenta de Netflix se omiten automaticamente.
              </p>
            </div>

            {isDashboardLoggedIn && !embedded && (
              <div className={styles.dashboardRow}>
                <Link href='/panel' className={styles.dashboardButton}>
                  Volver al panel
                </Link>
              </div>
            )}

            <div className={styles.platformGrid}>
              {CODE_PLATFORM_ORDER.map(platform => {
                const meta = CODE_PLATFORM_META[platform]

                return (
                  <button
                    key={platform}
                    type='button'
                    className={styles.platformCard}
                    data-platform={meta.accentClass}
                    onClick={() => handlePlatformSelect(platform)}
                  >
                    <strong>{meta.label}</strong>
                    <span>{meta.hint}</span>
                  </button>
                )
              })}
            </div>

            <p className={styles.catalogHint}>Selecciona una plataforma para continuar.</p>
          </section>
        )}

        {selectedPlatform && !selectedItem && platformMeta && (
          <section className={styles.workspace}>
            <header className={styles.workspaceHeader}>
              <button type='button' className={styles.backButton} onClick={handleBackToPlatforms}>
                Volver
              </button>
              <span className={styles.platformBadge} data-platform={platformMeta.accentClass}>
                {platformMeta.label}
              </span>
            </header>

            <article className={styles.searchCard}>
              <div className={styles.searchTitle}>
                <h2>Buscar correos</h2>
              </div>

              <div
                className={`${styles.searchForm} ${isSpecialNetflixFlow ? styles.searchFormSingle : ''}`}
              >
                <div className={styles.searchField}>
                  <label htmlFor='correo_consultar'>Correo electronico a consultar:</label>
                  <input
                    id='correo_consultar'
                    type='email'
                    placeholder='ejemplo@correo.com'
                    value={recipient}
                    onChange={event => setRecipient(event.target.value)}
                    onKeyDown={event => {
                      if (event.key !== 'Enter') return
                      event.preventDefault()
                      if (!isSpecialNetflixFlow) void handleFetch()
                    }}
                  />
                </div>

                {!isSpecialNetflixFlow && (
                  <button
                    type='button'
                    className={styles.searchButton}
                    onClick={() => void handleFetch()}
                    disabled={loading}
                  >
                    {loading ? 'Buscando...' : 'Buscar'}
                  </button>
                )}
              </div>

              {isSpecialNetflixFlow ? (
                <>
                  <div className={styles.specialInfo}>
                    Este correo usa el flujo especial de Telegram para Netflix. Elige una opcion y el
                    sistema esperara 15 segundos para devolver el ultimo mensaje nuevo del bot.
                  </div>

                  <div className={styles.specialActionGrid}>
                    {SPECIAL_NETFLIX_ACTIONS.map(action => (
                      <button
                        key={action.key}
                        type='button'
                        className={styles.specialActionButton}
                        data-active={telegramActionKey === action.key ? 'true' : 'false'}
                        onClick={() => void handleSpecialFetch(action.key)}
                        disabled={loading}
                      >
                        <strong>{action.label}</strong>
                        <span>{action.helperText}</span>
                      </button>
                    ))}
                  </div>
                </>
              ) : null}

              {error && <div className={styles.errorMessage}>{error}</div>}
            </article>

            {isSpecialNetflixFlow && telegramResult && (
              <article className={styles.specialResultCard}>
                <div className={styles.specialResultTop}>
                  <div>
                    <span className={styles.specialResultEyebrow}>Telegram en vivo</span>
                    <h3>{telegramResult.action_label}</h3>
                  </div>
                  {telegramResultDate && <span className={styles.specialResultDate}>{telegramResultDate}</span>}
                </div>

                <div className={styles.specialResultSummary}>
                  <span className={styles.recipientTag}>{telegramResult.recipient}</span>
                  <span>Espera fija: {telegramResult.wait_ms / 1000}s</span>
                  {activeTelegramAction && <span>Ultima opcion: {activeTelegramAction.label}</span>}
                </div>

                <div className={styles.specialResultBody}>
                  {telegramResultUrl ? (
                    <div className={styles.specialLinkGroup}>
                      <a
                        href={telegramResultUrl}
                        target='_blank'
                        rel='noreferrer noopener'
                        className={`${styles.actionButton} ${styles.specialLinkButton}`}
                      >
                        Abrir enlace
                      </a>
                      <p className={styles.specialLinkText}>{telegramResultUrl}</p>
                    </div>
                  ) : (
                    <pre className={styles.specialResultPre}>{telegramResult.message || '(Sin contenido)'}</pre>
                  )}
                </div>
              </article>
            )}

            {!isSpecialNetflixFlow && meta && visibleItems.length > 0 && (
              <div className={styles.statsBar}>
                <div className={styles.statsLeft}>
                  <span>
                    Se encontraron <strong>{visibleItems.length}</strong> correos para
                  </span>
                  <span className={styles.recipientTag}>{recipient.trim()}</span>
                </div>
                <div className={styles.statsRight}>
                  <span>Ultimo: {formatDateTime(latestVisibleDate)}</span>
                </div>
              </div>
            )}

            {!isSpecialNetflixFlow && meta && visibleItems.length === 0 && !loading && !error && (
              <div className={styles.emptyState}>No se encontraron correos para ese destinatario.</div>
            )}

            {!hasSearched && !error && isSpecialNetflixFlow && (
              <div className={styles.idleHint}>
                Este correo especial usa Telegram. Elige una de las 4 opciones para consultar el ultimo mensaje del bot.
              </div>
            )}

            {!isSpecialNetflixFlow && (
              <div className={styles.mailList}>
                {visibleItems.map(item => (
                  <article key={getItemKey(item)} className={styles.mailCard}>
                    <div className={styles.mailInfo}>
                      {item.variant_label && <span className={styles.variantBadge}>{item.variant_label}</span>}
                      <strong>{item.subject}</strong>
                      <div className={styles.mailMeta}>
                        <span>{formatDateTime(item.date)}</span>
                        <span>{item.from || '-'}</span>
                      </div>
                    </div>

                    <div className={styles.mailActions}>
                      {item.action_url && (
                        <a
                          href={item.action_url}
                          target='_blank'
                          rel='noreferrer noopener'
                          className={styles.actionButton}
                        >
                          {item.action_label || 'Abrir enlace'}
                        </a>
                      )}

                      <button
                        type='button'
                        className={styles.viewButton}
                        onClick={() => setSelectedItemKey(getItemKey(item))}
                      >
                        Ver correo
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        )}

        {selectedItem && platformMeta && (
          <section className={styles.workspace}>
            <header className={styles.workspaceHeader}>
              <button type='button' className={styles.backButton} onClick={() => setSelectedItemKey(null)}>
                Volver a la lista
              </button>
              <span className={styles.platformBadge} data-platform={platformMeta.accentClass}>
                {getCodePlatformLabel(selectedItem.platform)}
              </span>
            </header>

            <article className={styles.detailCard}>
              <div className={styles.detailTop} data-platform={platformMeta.accentClass}>
                {selectedItem.variant_label && <span className={styles.detailVariant}>{selectedItem.variant_label}</span>}
                <h2>{selectedItem.subject}</h2>
                <div className={styles.detailMeta}>
                  <span>{selectedItem.from || '-'}</span>
                  <span>{formatDateTime(selectedItem.date)}</span>
                </div>
              </div>

              <div className={styles.detailBody}>
                {selectedItem.action_url && (
                  <div className={styles.detailActions}>
                    <a
                      href={selectedItem.action_url}
                      target='_blank'
                      rel='noreferrer noopener'
                      className={styles.actionButton}
                    >
                      {selectedItem.action_label || 'Abrir enlace'}
                    </a>
                    <button
                      type='button'
                      className={styles.copyButton}
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(selectedItem.action_url || '')
                          setCopiedActionKey(getItemKey(selectedItem))
                          window.setTimeout(() => setCopiedActionKey(current => (current === getItemKey(selectedItem) ? null : current)), 1800)
                        } catch {
                          setCopiedActionKey(null)
                        }
                      }}
                    >
                      {copiedActionKey === getItemKey(selectedItem) ? 'Enlace copiado' : 'Copiar enlace'}
                    </button>
                  </div>
                )}

                {selectedItem.body_html ? (
                  <iframe
                    className={styles.detailFrame}
                    title={selectedItem.subject}
                    srcDoc={getExternalLinkHtml(selectedItem.body_html)}
                    sandbox='allow-popups allow-popups-to-escape-sandbox'
                  />
                ) : (
                  <pre>{selectedItem.body_text || '(Sin contenido)'}</pre>
                )}
              </div>
            </article>
          </section>
        )}
      </div>
    </main>
  )
}

export default function CodigosPage() {
  return <CodigosWorkspace />
}
