import { NextRequest, NextResponse } from 'next/server'
import { PanelApiError, requirePanelSession } from '@/lib/panel-auth'
import type { PanelAccount, ServiceAccountStatus } from '@/lib/panel-types'
import { normalizeDataUrlImage, parseMoney, parseNullableDate } from '@/lib/panel-utils'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type AccountRow = {
  id: string
  owner_id: string
  assigned_user_id: string
  service_name?: string
  account_email?: string
  account_type?: string
  cutoff_date?: string | null
  renewal_price: number | string
  renewal_period_days?: number
  status?: ServiceAccountStatus
  created_at?: string
  updated_at?: string
}

type ProfileMiniRow = {
  id: string
  username: string
}

const ACCOUNT_STATUSES = new Set<ServiceAccountStatus>(['activa', 'pausada', 'sin_pago', 'desactivada'])

const getDaysRemaining = (cutoffDate: string | null | undefined) => {
  if (!cutoffDate) return null
  const startOfToday = new Date()
  startOfToday.setHours(0, 0, 0, 0)
  const cutoff = new Date(`${cutoffDate}T00:00:00`)
  if (Number.isNaN(cutoff.getTime())) return null
  return Math.ceil((cutoff.getTime() - startOfToday.getTime()) / 86400000)
}

function mapAssignedAccount(params: {
  row: Required<Pick<AccountRow, 'id' | 'owner_id' | 'assigned_user_id'>> & AccountRow
  ownerUsername: string
}): PanelAccount {
  return {
    id: params.row.id,
    serviceName: params.row.service_name || 'Netflix',
    accountEmail: params.row.account_email || '',
    accountType: params.row.account_type || 'Cuenta completa',
    ownerId: params.row.owner_id,
    ownerUsername: params.ownerUsername,
    assignedUserId: params.row.assigned_user_id,
    cutoffDate: params.row.cutoff_date || null,
    renewalPrice: parseMoney(params.row.renewal_price, 0),
    renewalPeriodDays: Number(params.row.renewal_period_days || 30),
    status: ACCOUNT_STATUSES.has(params.row.status as ServiceAccountStatus)
      ? (params.row.status as ServiceAccountStatus)
      : 'activa',
    createdAt: params.row.created_at || new Date().toISOString(),
    updatedAt: params.row.updated_at || new Date().toISOString(),
    daysRemaining: getDaysRemaining(params.row.cutoff_date),
  }
}

async function ensureNoActiveSupportRequest(
  accountId: string,
  requesterId: string,
  supabaseAdmin: Awaited<ReturnType<typeof requirePanelSession>>['supabaseAdmin']
) {
  const activeResp = await supabaseAdmin
    .from('support_requests')
    .select('id')
    .eq('account_id', accountId)
    .eq('requester_id', requesterId)
    .limit(1)
    .maybeSingle()

  if (activeResp.error) {
    throw new PanelApiError(activeResp.error.message, 500)
  }

  const existingRequest = (activeResp.data || null) as { id: string } | null

  if (existingRequest?.id) {
    throw new PanelApiError('Ya tienes una solicitud activa para esta cuenta.', 400)
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      action?: string
      accountId?: string
      subject?: string
      description?: string
      paymentProofDataUrl?: string
      userId?: string
      emails?: string[]
      assignments?: Array<{
        userId?: string
        email?: string
        cutoffDate?: string | null
      }>
      serviceName?: string
      accountType?: string
      cutoffDate?: string
      renewalPrice?: number
      renewalPeriodDays?: number
      status?: string
    }

    const action = String(body.action || '').trim()

    if (action === 'assign') {
      const session = await requirePanelSession(request, true)
      const userId = String(body.userId || '').trim()
      const rawAssignments = Array.isArray(body.assignments) ? body.assignments : []
      const assignments =
        rawAssignments.length > 0
          ? rawAssignments
              .map(item => ({
                userId: String(item.userId || '').trim(),
                accountEmail: String(item.email || '').trim().toLowerCase(),
                cutoffDate: parseNullableDate(item.cutoffDate),
              }))
              .filter(item => item.userId && item.accountEmail)
          : Array.from(
              new Set(
                Array.isArray(body.emails)
                  ? body.emails.map(item => String(item || '').trim().toLowerCase()).filter(Boolean)
                  : []
              )
            ).map(accountEmail => ({
              userId,
              accountEmail,
              cutoffDate: parseNullableDate(body.cutoffDate),
            }))
      const serviceName = String(body.serviceName || 'Netflix').trim() || 'Netflix'
      const accountType = String(body.accountType || 'Cuenta completa').trim() || 'Cuenta completa'
      const renewalPrice = parseMoney(body.renewalPrice, 0)
      const renewalPeriodDays = Math.max(1, Number(body.renewalPeriodDays || 30) || 30)
      const status = String(body.status || 'activa').trim() as ServiceAccountStatus

      if (assignments.some(item => !item.userId)) {
        throw new PanelApiError('Selecciona un usuario.', 400)
      }

      if (assignments.length === 0) {
        throw new PanelApiError('Agrega al menos un correo para asignar.', 400)
      }

      if (!ACCOUNT_STATUSES.has(status)) {
        throw new PanelApiError('Estado de cuenta no valido.', 400)
      }

      const targetUserIds = Array.from(new Set(assignments.map(item => item.userId)))
      const targetResp = await session.supabaseAdmin
        .from('profiles')
        .select('id, username')
        .in('id', targetUserIds)

      if (targetResp.error) {
        throw new PanelApiError(targetResp.error.message, 500)
      }

      const targetUsers = (targetResp.data || []) as ProfileMiniRow[]
      const validTargetIds = new Set(targetUsers.map(item => item.id))
      if (targetUserIds.some(id => !validTargetIds.has(id))) {
        throw new PanelApiError('Uno de los usuarios ya no existe en profiles.', 404)
      }

      const uniqueAssignments = Array.from(
        new Map(
          assignments.map(item => [`${item.userId}:${serviceName}:${item.accountEmail}`, item])
        ).values()
      )

      const rows = uniqueAssignments.map(item => ({
        owner_id: session.profile.id,
        assigned_user_id: item.userId,
        service_name: serviceName,
        account_email: item.accountEmail,
        account_type: accountType,
        cutoff_date: item.cutoffDate,
        renewal_price: renewalPrice,
        renewal_period_days: renewalPeriodDays,
        status,
        updated_at: new Date().toISOString(),
      }))

      const upsertResp = await session.supabaseAdmin
        .from('service_accounts')
        .upsert(rows as never, {
          onConflict: 'assigned_user_id,service_name,account_email',
        })
        .select(
          'id, owner_id, assigned_user_id, service_name, account_email, account_type, cutoff_date, renewal_price, renewal_period_days, status, created_at, updated_at'
        )

      if (upsertResp.error) {
        throw new PanelApiError(upsertResp.error.message, 500)
      }

      const savedRows = (upsertResp.data || []) as AccountRow[]
      if (savedRows.length === 0) {
        throw new PanelApiError('Supabase no devolvio cuentas guardadas.', 500)
      }

      return NextResponse.json({
        message: savedRows.length > 1 ? 'Cuentas asignadas.' : 'Cuenta asignada.',
        ids: savedRows.map(item => item.id),
        accounts: savedRows.map(row =>
          mapAssignedAccount({
            row: row as Required<Pick<AccountRow, 'id' | 'owner_id' | 'assigned_user_id'>> & AccountRow,
            ownerUsername: session.profile.username,
          })
        ),
      })
    }

    if (action === 'remove') {
      const session = await requirePanelSession(request, true)
      const accountId = String(body.accountId || '').trim()
      if (!accountId) {
        throw new PanelApiError('Cuenta no valida.', 400)
      }

      const deleteResp = await session.supabaseAdmin
        .from('service_accounts')
        .delete()
        .eq('id', accountId)
        .eq('owner_id', session.profile.id)
        .select('id')

      if (deleteResp.error) {
        throw new PanelApiError(deleteResp.error.message, 500)
      }

      const deletedRows = (deleteResp.data || []) as Array<{ id: string }>
      if (deletedRows.length === 0) {
        throw new PanelApiError('No se pudo quitar la cuenta o ya fue retirada.', 404)
      }

      return NextResponse.json({ message: 'Cuenta retirada.', accountId })
    }

    const session = await requirePanelSession(request)
    const accountId = String(body.accountId || '').trim()

    if (!accountId) {
      throw new PanelApiError('Cuenta no valida.', 400)
    }

    const accountResp = await session.supabaseAdmin
      .from('service_accounts')
      .select('id, owner_id, assigned_user_id, renewal_price')
      .eq('id', accountId)
      .eq('assigned_user_id', session.profile.id)
      .maybeSingle()

    if (accountResp.error) {
      throw new PanelApiError(accountResp.error.message, 500)
    }

    const account = accountResp.data as AccountRow | null
    if (!account?.id) {
      throw new PanelApiError('No tienes acceso a esa cuenta.', 403)
    }

    if (action === 'support_issue') {
      const subject = String(body.subject || '').trim()
      const description = String(body.description || '').trim()

      if (!subject) {
        throw new PanelApiError('Ingresa el asunto del soporte.', 400)
      }

      if (!description) {
        throw new PanelApiError('Ingresa la descripcion del problema.', 400)
      }

      await ensureNoActiveSupportRequest(account.id, session.profile.id, session.supabaseAdmin)

      const insertResp = await session.supabaseAdmin
        .from('support_requests')
        .insert({
          account_id: account.id,
          requester_id: session.profile.id,
          owner_id: account.owner_id,
          request_kind: 'issue',
          status: 'abierta',
          subject,
          description,
        } as never)
        .select('id')
        .maybeSingle()

      if (insertResp.error) {
        throw new PanelApiError(insertResp.error.message, 500)
      }

      const insertedRequest = (insertResp.data || null) as { id: string } | null

      return NextResponse.json({
        message: 'Solicitud enviada a soporte.',
        requestId: insertedRequest?.id || null,
      })
    }

    if (action === 'support_no_payment') {
      await ensureNoActiveSupportRequest(account.id, session.profile.id, session.supabaseAdmin)

      const insertResp = await session.supabaseAdmin
        .from('support_requests')
        .insert({
          account_id: account.id,
          requester_id: session.profile.id,
          owner_id: account.owner_id,
          request_kind: 'no_payment',
          status: 'pendiente_revision',
          subject: 'La cuenta esta sin pago',
          description: 'El cliente reporto que la cuenta aparece sin pago.',
        } as never)
        .select('id')
        .maybeSingle()

      if (insertResp.error) {
        throw new PanelApiError(insertResp.error.message, 500)
      }

      const insertedRequest = (insertResp.data || null) as { id: string } | null

      return NextResponse.json({
        message: 'Solicitud de pago reportada.',
        requestId: insertedRequest?.id || null,
      })
    }

    if (action === 'renewal') {
      const paymentProofDataUrl = normalizeDataUrlImage(body.paymentProofDataUrl)

      await ensureNoActiveSupportRequest(account.id, session.profile.id, session.supabaseAdmin)

      const insertResp = await session.supabaseAdmin
        .from('support_requests')
        .insert({
          account_id: account.id,
          requester_id: session.profile.id,
          owner_id: account.owner_id,
          request_kind: 'renewal',
          status: 'pendiente_revision',
          subject: 'Solicitud de renovacion',
          description: 'El cliente envio su solicitud de renovacion.',
          payment_proof_data_url: paymentProofDataUrl,
          renewal_price: parseMoney(account.renewal_price, 0),
        } as never)
        .select('id')
        .maybeSingle()

      if (insertResp.error) {
        throw new PanelApiError(insertResp.error.message, 500)
      }

      const insertedRequest = (insertResp.data || null) as { id: string } | null

      return NextResponse.json({
        message: 'Renovacion enviada al proveedor.',
        requestId: insertedRequest?.id || null,
      })
    }

    throw new PanelApiError('Accion no soportada.', 400)
  } catch (error) {
    const status = error instanceof PanelApiError ? error.status : 500
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'No se pudo completar la accion.',
      },
      { status }
    )
  }
}
