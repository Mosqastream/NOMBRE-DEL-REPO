import { NextRequest, NextResponse } from 'next/server'
import { PanelApiError, requirePanelSession } from '@/lib/panel-auth'
import { normalizeDataUrlImage, parseMoney, parseNullableDate } from '@/lib/panel-utils'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type AccountRow = {
  id: string
  owner_id: string
  assigned_user_id: string
  renewal_price: number | string
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
      const emails = Array.isArray(body.emails)
        ? body.emails.map(item => String(item || '').trim().toLowerCase()).filter(Boolean)
        : []
      const serviceName = String(body.serviceName || 'Netflix').trim() || 'Netflix'
      const accountType = String(body.accountType || 'Cuenta completa').trim() || 'Cuenta completa'
      const cutoffDate = parseNullableDate(body.cutoffDate)
      const renewalPrice = parseMoney(body.renewalPrice, 0)
      const renewalPeriodDays = Math.max(1, Number(body.renewalPeriodDays || 30) || 30)
      const status = String(body.status || 'activa').trim() || 'activa'

      if (!userId) {
        throw new PanelApiError('Selecciona un usuario.', 400)
      }

      if (emails.length === 0) {
        throw new PanelApiError('Agrega al menos un correo para asignar.', 400)
      }

      const rows = emails.map(accountEmail => ({
        owner_id: session.profile.id,
        assigned_user_id: userId,
        service_name: serviceName,
        account_email: accountEmail,
        account_type: accountType,
        cutoff_date: cutoffDate,
        renewal_price: renewalPrice,
        renewal_period_days: renewalPeriodDays,
        status,
      }))

      const insertResp = await session.supabaseAdmin
        .from('service_accounts')
        .insert(rows as never)
        .select('id')
      if (insertResp.error) {
        throw new PanelApiError(insertResp.error.message, 500)
      }

      const insertedRows = (insertResp.data || []) as Array<{ id: string }>

      return NextResponse.json({
        message: emails.length > 1 ? 'Cuentas asignadas.' : 'Cuenta asignada.',
        ids: insertedRows.map(item => item.id),
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
