import { NextRequest, NextResponse } from 'next/server'
import { CodesAccessError, enforceCodesRecipientAccess } from '@/lib/codes-access'
import {
  getSpecialNetflixAction,
  isSpecialNetflixRecipient,
  normalizeSpecialRecipient,
} from '@/lib/codes-telegram-special'
import { invokeDirectTelegramFlow } from '@/lib/codes-telegram-direct'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120
export const preferredRegion = 'iad1'

const BRIDGE_TIMEOUT_MS = 115000

const normalizeText = (value: unknown) => (typeof value === 'string' ? value.trim() : '')

const getBridgeConfig = () => {
  const bridgeUrl = normalizeText(process.env.CODES_TELEGRAM_BRIDGE_URL).replace(/\/+$/, '')
  const bridgeSecret = normalizeText(process.env.CODES_TELEGRAM_BRIDGE_SECRET)

  if (!bridgeUrl) {
    return null
  }

  if (!bridgeSecret) {
    throw new Error('Falta CODES_TELEGRAM_BRIDGE_SECRET para el puente local de Telegram.')
  }

  return {
    bridgeSecret,
    bridgeUrl,
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => null)) as
      | {
          action?: string
          recipient?: string
        }
      | null

    const recipient = normalizeSpecialRecipient(body?.recipient || '')
    const action = getSpecialNetflixAction(body?.action || '')

    if (!recipient || !recipient.includes('@')) {
      return NextResponse.json({ error: 'Ingresa un correo valido.' }, { status: 400 })
    }

    if (!action) {
      return NextResponse.json({ error: 'Selecciona una opcion valida.' }, { status: 400 })
    }

    await enforceCodesRecipientAccess({
      request,
      recipient,
    })

    if (!isSpecialNetflixRecipient(recipient)) {
      const { getSupabaseAdmin } = await import('@/lib/supabaseAdmin')
      const supabaseAdmin = getSupabaseAdmin()
      const telegramResp = await supabaseAdmin
        .from('telegram_code_accounts')
        .select('id')
        .eq('account_email', recipient)
        .eq('enabled', true)
        .limit(1)
        .maybeSingle()

      if (telegramResp.error) {
        throw new Error(telegramResp.error.message)
      }

      const telegramAccount = (telegramResp.data || null) as { id: string } | null
      if (!telegramAccount?.id) {
        return NextResponse.json({ error: 'Este correo no usa el flujo especial de Telegram.' }, { status: 403 })
      }
    }

    const bridgeConfig = getBridgeConfig()

    if (!bridgeConfig) {
      const payload = await invokeDirectTelegramFlow({
        action: action.key,
        recipient,
      })
      return NextResponse.json(payload)
    }

    const { bridgeSecret, bridgeUrl } = bridgeConfig
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), BRIDGE_TIMEOUT_MS)

    try {
      const response = await fetch(`${bridgeUrl}/invoke`, {
        method: 'POST',
        cache: 'no-store',
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${bridgeSecret}`,
          'bypass-tunnel-reminder': 'true',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          action: action.key,
          platform: 'netflix',
          recipient,
        }),
      })

      const rawPayload = await response.text()
      let payload: { error?: string } & Record<string, unknown> = {}

      if (rawPayload) {
        try {
          payload = JSON.parse(rawPayload) as { error?: string } & Record<string, unknown>
        } catch {
          payload = { error: rawPayload }
        }
      }

      if (!response.ok) {
        return NextResponse.json(
          { error: payload?.error || 'El puente local de Telegram no pudo completar la solicitud.' },
          { status: response.status }
        )
      }

      return NextResponse.json(payload)
    } finally {
      clearTimeout(timeoutId)
    }
  } catch (error: unknown) {
    if (error instanceof CodesAccessError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }

    if (error instanceof Error && error.name === 'AbortError') {
      return NextResponse.json(
        { error: 'El puente local de Telegram tardo demasiado en responder.' },
        { status: 504 }
      )
    }

    const message = error instanceof Error ? error.message : 'No se pudo completar el flujo de Telegram.'
    if (/AUTH_KEY_(UNREGISTERED|DUPLICATED|INVALID)/i.test(message)) {
      return NextResponse.json(
        {
          error:
            'La sesion de Telegram vencio o fue invalidada. Genera una nueva TELEGRAM_SESSION_STRING y actualizala en Vercel.',
        },
        { status: 401 }
      )
    }

    return NextResponse.json({ error: message }, { status: 500 })
  }
}
