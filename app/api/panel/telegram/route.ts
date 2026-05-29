import { NextRequest, NextResponse } from 'next/server'
import { PanelApiError, requirePanelSession } from '@/lib/panel-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type TelegramAccountRow = {
  id: string
  owner_id: string
  account_email: string
  service_name: string
  enabled: boolean
  created_at: string
  updated_at: string
}

const normalizeEmail = (value: unknown) => String(value || '').trim().toLowerCase()

const mapTelegramAccount = (row: TelegramAccountRow) => ({
  id: row.id,
  ownerId: row.owner_id,
  accountEmail: row.account_email,
  serviceName: row.service_name,
  enabled: Boolean(row.enabled),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
})

export async function GET(request: NextRequest) {
  try {
    const session = await requirePanelSession(request, true)
    const response = await session.supabaseAdmin
      .from('telegram_code_accounts')
      .select('id, owner_id, account_email, service_name, enabled, created_at, updated_at')
      .eq('owner_id', session.profile.id)
      .order('created_at', { ascending: false })

    if (response.error) {
      throw new PanelApiError(response.error.message, 500)
    }

    return NextResponse.json({
      accounts: ((response.data || []) as TelegramAccountRow[]).map(mapTelegramAccount),
    })
  } catch (error) {
    const status = error instanceof PanelApiError ? error.status : 500
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'No se pudo cargar Telegram.' },
      { status }
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await requirePanelSession(request, true)
    const body = (await request.json().catch(() => ({}))) as {
      action?: string
      accountId?: string
      accountEmail?: string
      serviceName?: string
    }
    const action = String(body.action || '').trim()

    if (action === 'create') {
      const accountEmail = normalizeEmail(body.accountEmail)
      const serviceName = String(body.serviceName || 'Netflix').trim() || 'Netflix'

      if (!accountEmail || !accountEmail.includes('@')) {
        throw new PanelApiError('Ingresa un correo valido.', 400)
      }

      const upsertResp = await session.supabaseAdmin
        .from('telegram_code_accounts')
        .upsert(
          {
            owner_id: session.profile.id,
            account_email: accountEmail,
            service_name: serviceName,
            enabled: true,
            updated_at: new Date().toISOString(),
          } as never,
          { onConflict: 'owner_id,account_email' }
        )
        .select('id, owner_id, account_email, service_name, enabled, created_at, updated_at')
        .maybeSingle()

      const account = (upsertResp.data || null) as TelegramAccountRow | null

      if (upsertResp.error || !account?.id) {
        throw new PanelApiError(upsertResp.error?.message || 'No se pudo guardar la cuenta Telegram.', 500)
      }

      return NextResponse.json({
        message: 'Cuenta Telegram guardada.',
        account: mapTelegramAccount(account),
      })
    }

    const accountId = String(body.accountId || '').trim()
    if (!accountId) {
      throw new PanelApiError('Cuenta Telegram no valida.', 400)
    }

    if (action === 'toggle') {
      const currentResp = await session.supabaseAdmin
        .from('telegram_code_accounts')
        .select('id, enabled')
        .eq('id', accountId)
        .eq('owner_id', session.profile.id)
        .maybeSingle()

      const current = (currentResp.data || null) as { id: string; enabled: boolean } | null
      if (currentResp.error || !current?.id) {
        throw new PanelApiError(currentResp.error?.message || 'Cuenta Telegram no encontrada.', 404)
      }

      const updateResp = await session.supabaseAdmin
        .from('telegram_code_accounts')
        .update({ enabled: !current.enabled, updated_at: new Date().toISOString() } as never)
        .eq('id', accountId)
        .eq('owner_id', session.profile.id)

      if (updateResp.error) {
        throw new PanelApiError(updateResp.error.message, 500)
      }

      return NextResponse.json({ message: current.enabled ? 'Cuenta Telegram desactivada.' : 'Cuenta Telegram activada.' })
    }

    if (action === 'delete') {
      const deleteResp = await session.supabaseAdmin
        .from('telegram_code_accounts')
        .delete()
        .eq('id', accountId)
        .eq('owner_id', session.profile.id)
        .select('id')

      if (deleteResp.error) {
        throw new PanelApiError(deleteResp.error.message, 500)
      }

      const deletedRows = (deleteResp.data || []) as Array<{ id: string }>
      if (deletedRows.length === 0) {
        throw new PanelApiError('No se pudo borrar la cuenta Telegram o ya no existe.', 404)
      }

      return NextResponse.json({ message: 'Cuenta Telegram eliminada.' })
    }

    throw new PanelApiError('Accion no soportada.', 400)
  } catch (error) {
    const status = error instanceof PanelApiError ? error.status : 500
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'No se pudo completar Telegram.' },
      { status }
    )
  }
}
