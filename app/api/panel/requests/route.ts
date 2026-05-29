import { NextRequest, NextResponse } from 'next/server'
import { PanelApiError, requirePanelSession } from '@/lib/panel-auth'
import { normalizeDataUrlImage } from '@/lib/panel-utils'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type RequestRow = {
  id: string
  account_id?: string | null
  requester_id: string
  owner_id: string
  status: string
  request_kind: string
  subject?: string
  description?: string | null
  created_at?: string
  service_accounts?: {
    account_email: string
    service_name: string
  } | null
}

type MessageRow = {
  body: string
  created_at: string
}

async function archiveAndDeleteRequest(
  session: Awaited<ReturnType<typeof requirePanelSession>>,
  requestRow: RequestRow
) {
  const messagesResp = await session.supabaseAdmin
    .from('support_messages')
    .select('body, created_at')
    .eq('request_id', requestRow.id)
    .order('created_at', { ascending: true })

  if (messagesResp.error) {
    throw new PanelApiError(messagesResp.error.message, 500)
  }

  const messages = (messagesResp.data || []) as MessageRow[]
  const lastMessagePreview = messages.length > 0 ? String(messages[messages.length - 1].body || '').slice(0, 180) : null
  const summaryParts = [
    requestRow.subject || 'Solicitud',
    requestRow.service_accounts?.service_name || 'Servicio',
    messages.length > 0 ? `${messages.length} mensajes` : 'Sin mensajes',
  ]

  const historyResp = await session.supabaseAdmin.from('support_request_history').insert({
    account_email: requestRow.service_accounts?.account_email || null,
    service_name: requestRow.service_accounts?.service_name || null,
    requester_id: requestRow.requester_id,
    owner_id: requestRow.owner_id,
    request_kind: requestRow.request_kind,
    subject: requestRow.subject || 'Solicitud',
    description: requestRow.description || null,
    summary: summaryParts.join(' · '),
    message_count: messages.length,
    last_message_preview: lastMessagePreview,
    closed_by_id: session.profile.id,
    created_at: requestRow.created_at || new Date().toISOString(),
  } as never)

  if (historyResp.error) {
    throw new PanelApiError(historyResp.error.message, 500)
  }

  const deleteResp = await session.supabaseAdmin.from('support_requests').delete().eq('id', requestRow.id)

  if (deleteResp.error) {
    throw new PanelApiError(deleteResp.error.message, 500)
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await requirePanelSession(request)
    const body = (await request.json().catch(() => ({}))) as {
      action?: string
      requestId?: string
      body?: string
      imageDataUrl?: string
      status?: string
      accountEmail?: string
    }

    const action = String(body.action || '').trim()
    const requestId = String(body.requestId || '').trim()

    if (!requestId) {
      throw new PanelApiError('Solicitud no valida.', 400)
    }

    const requestResp = await session.supabaseAdmin
      .from('support_requests')
      .select(
        'id, account_id, requester_id, owner_id, status, request_kind, subject, description, created_at, service_accounts(account_email, service_name)'
      )
      .eq('id', requestId)
      .maybeSingle()

    if (requestResp.error) {
      throw new PanelApiError(requestResp.error.message, 500)
    }

    const currentRequest = requestResp.data as RequestRow | null
    if (!currentRequest?.id) {
      throw new PanelApiError('Solicitud no encontrada.', 404)
    }

    const canAccess =
      currentRequest.requester_id === session.profile.id ||
      currentRequest.owner_id === session.profile.id ||
      session.profile.role === 'owner'

    if (!canAccess) {
      throw new PanelApiError('No puedes acceder a esta solicitud.', 403)
    }

    if (action === 'message') {
      if (currentRequest.status === 'cierre_solicitado') {
        throw new PanelApiError('Este ticket esta esperando confirmacion de cierre.', 400)
      }

      const messageBody = String(body.body || '').trim()
      const imageDataUrl = normalizeDataUrlImage(body.imageDataUrl)

      if (!messageBody && !imageDataUrl) {
        throw new PanelApiError('Escribe un mensaje o adjunta una imagen.', 400)
      }

      const insertResp = await session.supabaseAdmin.from('support_messages').insert({
        request_id: requestId,
        sender_id: session.profile.id,
        sender_role: session.profile.role,
        body: messageBody || 'Imagen adjunta',
        image_data_url: imageDataUrl,
      } as never)

      if (insertResp.error) {
        throw new PanelApiError(insertResp.error.message, 500)
      }

      await session.supabaseAdmin
        .from('support_requests')
        .update({
          status: 'en_chat',
        } as never)
        .eq('id', requestId)

      return NextResponse.json({ message: 'Mensaje enviado.' })
    }

    if (action === 'status') {
      if (session.profile.role !== 'owner' || currentRequest.owner_id !== session.profile.id) {
        throw new PanelApiError('Solo el owner puede cambiar este estado.', 403)
      }

      const nextStatus = String(body.status || '').trim()
      const allowedStatuses = new Set([
        'abierta',
        'en_chat',
        'pendiente_revision',
        'aprobada',
        'rechazada',
        'cierre_solicitado',
        'cerrada',
      ])

      if (!allowedStatuses.has(nextStatus)) {
        throw new PanelApiError('Estado no valido.', 400)
      }

      const updateResp = await session.supabaseAdmin
        .from('support_requests')
        .update({
          status: nextStatus,
        } as never)
        .eq('id', requestId)

      if (updateResp.error) {
        throw new PanelApiError(updateResp.error.message, 500)
      }

      return NextResponse.json({ message: 'Estado actualizado.' })
    }

    if (action === 'request_close') {
      if (session.profile.role !== 'owner' || currentRequest.owner_id !== session.profile.id) {
        throw new PanelApiError('Solo el owner puede solicitar el cierre.', 403)
      }

      const updateResp = await session.supabaseAdmin
        .from('support_requests')
        .update({
          status: 'cierre_solicitado',
        } as never)
        .eq('id', requestId)

      if (updateResp.error) {
        throw new PanelApiError(updateResp.error.message, 500)
      }

      return NextResponse.json({ message: 'Cierre enviado para confirmacion del cliente.' })
    }

    if (action === 'replace_account_email') {
      if (session.profile.role !== 'owner' || currentRequest.owner_id !== session.profile.id) {
        throw new PanelApiError('Solo el owner puede reemplazar esta cuenta.', 403)
      }

      if (currentRequest.request_kind !== 'no_payment') {
        throw new PanelApiError('Solo las solicitudes sin pago permiten reemplazar correo.', 400)
      }

      if (!currentRequest.account_id) {
        throw new PanelApiError('Esta solicitud no tiene una cuenta vinculada.', 400)
      }

      const accountEmail = String(body.accountEmail || '').trim().toLowerCase()
      if (!accountEmail || !accountEmail.includes('@')) {
        throw new PanelApiError('Ingresa un correo valido para reemplazar.', 400)
      }

      const updateAccountResp = await session.supabaseAdmin
        .from('service_accounts')
        .update({
          account_email: accountEmail,
          updated_at: new Date().toISOString(),
        } as never)
        .eq('id', currentRequest.account_id)
        .eq('owner_id', session.profile.id)
        .select('id')
        .maybeSingle()

      if (updateAccountResp.error) {
        throw new PanelApiError(updateAccountResp.error.message, 500)
      }

      if (!updateAccountResp.data) {
        throw new PanelApiError('No se encontro la cuenta para reemplazar.', 404)
      }

      const messageResp = await session.supabaseAdmin.from('support_messages').insert({
        request_id: requestId,
        sender_id: session.profile.id,
        sender_role: session.profile.role,
        body: `Correo reemplazado exitosamente: ${accountEmail}`,
      } as never)

      if (messageResp.error) {
        throw new PanelApiError(messageResp.error.message, 500)
      }

      const updateRequestResp = await session.supabaseAdmin
        .from('support_requests')
        .update({
          status: 'en_chat',
        } as never)
        .eq('id', requestId)

      if (updateRequestResp.error) {
        throw new PanelApiError(updateRequestResp.error.message, 500)
      }

      return NextResponse.json({ message: 'Correo reemplazado y cliente notificado.' })
    }

    if (action === 'confirm_close') {
      if (currentRequest.requester_id !== session.profile.id) {
        throw new PanelApiError('Solo el cliente puede confirmar el cierre.', 403)
      }

      if (currentRequest.status !== 'cierre_solicitado') {
        throw new PanelApiError('Este ticket aun no esta listo para confirmar su cierre.', 400)
      }

      await archiveAndDeleteRequest(session, currentRequest)
      return NextResponse.json({ message: 'Ticket cerrado y archivado.' })
    }

    throw new PanelApiError('Accion no soportada.', 400)
  } catch (error) {
    const status = error instanceof PanelApiError ? error.status : 500
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'No se pudo completar la solicitud.',
      },
      { status }
    )
  }
}
