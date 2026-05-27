'use client'

import { useMemo, useState } from 'react'
import styles from './clientes.module.css'

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

type ClienteInboxPayload = {
  recipient: string
  travel: ClienteMailResult[]
  household: ClienteMailResult[]
}

type ClienteViewKind = 'travel' | 'household'

function normalizeRecipient(rawValue: string) {
  return rawValue.trim().toLowerCase()
}

function formatDate(value: string | null) {
  if (!value) return '-'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return '-'
  return parsed.toLocaleString('es-PE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default function ClientesPage() {
  const [recipientInput, setRecipientInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [payload, setPayload] = useState<ClienteInboxPayload | null>(null)
  const [selectedKind, setSelectedKind] = useState<ClienteViewKind>('travel')
  const [copied, setCopied] = useState(false)

  const normalizedRecipient = useMemo(() => normalizeRecipient(recipientInput), [recipientInput])
  const selectedItem =
    selectedKind === 'travel' ? payload?.travel?.[0] ?? null : payload?.household?.[0] ?? null

  const iframeDoc = selectedItem?.bodyHtml
    ? `<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      html, body { margin: 0; padding: 0; background: #ffffff; color: #111111; font-family: Arial, Helvetica, sans-serif; }
      body { padding: 12px; }
      img { max-width: 100% !important; height: auto !important; }
      table { max-width: 100% !important; }
      td, th, p, span, div, a { word-break: break-word; }
      a { color: #c1121f; }
    </style>
  </head>
  <body>${selectedItem.bodyHtml}</body>
</html>`
    : ''

  async function handleSearch() {
    const recipient = normalizeRecipient(recipientInput)
    if (!recipient || !recipient.includes('@')) {
      setError('Ingresa un correo valido.')
      setPayload(null)
      return
    }

    setLoading(true)
    setError('')

    try {
      const response = await fetch(`/api/clientes?recipient=${encodeURIComponent(recipient)}`, {
        cache: 'no-store',
      })
      const data = (await response.json().catch(() => ({}))) as Partial<ClienteInboxPayload> & {
        error?: string
      }

      if (!response.ok) {
        throw new Error(data.error || 'No se pudieron cargar los correos.')
      }

      setPayload({
        recipient: String(data.recipient || recipient),
        travel: Array.isArray(data.travel) ? data.travel : [],
        household: Array.isArray(data.household) ? data.household : [],
      })
    } catch (searchError) {
      setPayload(null)
      setError(searchError instanceof Error ? searchError.message : 'No se pudieron cargar los correos.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <section className={styles.hero}>
          <span className={styles.eyebrow}>Netflix clientes</span>
          <h1>Estoy de viaje / Actualizar hogar</h1>
          <p>
            Ingresa el correo del cliente para ver el ultimo mensaje valido y abrir su accion
            correspondiente.
          </p>
        </section>

        <section className={styles.searchCard}>
          <strong>Buscar correo</strong>
          <div className={styles.searchRow}>
            <input
              className={styles.input}
              type='text'
              value={recipientInput}
              onChange={event => setRecipientInput(event.target.value)}
              placeholder='cliente@correo.com'
            />
            <button
              type='button'
              className={styles.button}
              onClick={() => void handleSearch()}
              disabled={loading}
            >
              {loading ? 'Buscando...' : 'Buscar'}
            </button>
          </div>

          {normalizedRecipient && <div className={styles.note}>Destino preparado: {normalizedRecipient}</div>}
          {error && <p className={styles.error}>{error}</p>}
        </section>

        <section className={styles.viewerCard}>
          <div className={styles.toggleRow}>
            <button
              type='button'
              className={selectedKind === 'travel' ? styles.toggleActive : styles.toggle}
              onClick={() => setSelectedKind('travel')}
            >
              Estoy de viaje
            </button>
            <button
              type='button'
              className={selectedKind === 'household' ? styles.toggleActive : styles.toggle}
              onClick={() => setSelectedKind('household')}
            >
              Actualizar hogar
            </button>
          </div>

          {!selectedItem && (
            <div className={styles.emptyCard}>
              No se encontro un correo reciente para esta categoria.
            </div>
          )}

          {selectedItem && (
            <article className={styles.mailCard}>
              <div className={styles.mailHeader}>
                <h2>{selectedKind === 'travel' ? 'Estoy de viaje' : 'Actualizar hogar'}</h2>
                <span className={styles.badge}>Ultimo correo</span>
              </div>

              <div className={styles.meta}>
                <span>Asunto: {selectedItem.subject}</span>
                <span>Recibido: {formatDate(selectedItem.receivedAt)}</span>
                <span>Remitente: {selectedItem.from || 'Netflix'}</span>
              </div>

              {selectedItem.actionUrl && (
                <div className={styles.actionRow}>
                  <a
                    href={selectedItem.actionUrl}
                    target='_blank'
                    rel='noreferrer noopener'
                    className={styles.openButton}
                  >
                    {selectedItem.actionLabel || 'Abrir enlace'}
                  </a>
                  <button
                    type='button'
                    className={styles.copyButton}
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(selectedItem.actionUrl || '')
                        setCopied(true)
                        window.setTimeout(() => setCopied(false), 1800)
                      } catch {
                        setCopied(false)
                      }
                    }}
                  >
                    {copied ? 'Enlace copiado' : 'Copiar enlace'}
                  </button>
                </div>
              )}

              {iframeDoc ? (
                <div className={styles.iframeWrap}>
                  <iframe
                    className={styles.iframe}
                    title={`${selectedKind}-${selectedItem.id}`}
                    srcDoc={iframeDoc}
                    sandbox='allow-popups allow-popups-to-escape-sandbox allow-top-navigation-by-user-activation'
                    referrerPolicy='no-referrer'
                  />
                </div>
              ) : (
                <pre className={styles.textBlock}>{selectedItem.bodyText || selectedItem.snippet}</pre>
              )}
            </article>
          )}
        </section>
      </div>
    </main>
  )
}
