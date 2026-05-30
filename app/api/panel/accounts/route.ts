import { NextRequest, NextResponse } from 'next/server'
import * as XLSX from 'xlsx'
import { PanelApiError, requirePanelSession } from '@/lib/panel-auth'
import type { PanelAccount, ServiceAccountStatus } from '@/lib/panel-types'
import { normalizeUsername, validateUsername } from '@/lib/auth-identity'
import { resolveSdnetpanelNoPaymentReplacement } from '@/lib/codes-sdnetpanel'
import { normalizeDataUrlImage, parseMoney, parseNullableDate } from '@/lib/panel-utils'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type AccountRow = {
  id: string
  owner_id: string
  assigned_user_id: string
  assigned_by_id?: string | null
  parent_account_id?: string | null
  root_account_id?: string | null
  assignment_depth?: number
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
  parent_id?: string | null
  created_by_id?: string | null
}

type SupabaseAdminClient = Awaited<ReturnType<typeof requirePanelSession>>['supabaseAdmin']

type PreviewAssignment = {
  email: string
  userId: string
  username: string
  cutoffDate: string | null
  serviceName: string
  accountType: string
}

type PreviewOmitted = {
  email: string
  reason: string
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
    assignedById: params.row.assigned_by_id || null,
    parentAccountId: params.row.parent_account_id || null,
    rootAccountId: params.row.root_account_id || params.row.id,
    assignmentDepth: Number(params.row.assignment_depth || 0),
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
  params: {
    account: AccountRow
    requesterId: string
    supabaseAdmin: SupabaseAdminClient
  }
) {
  const rootAccountId = params.account.root_account_id || params.account.id
  const accountIds = new Set<string>([params.account.id, rootAccountId])

  const chainResp = await params.supabaseAdmin
    .from('service_accounts')
    .select('id')
    .eq('owner_id', params.account.owner_id)
    .or(`id.eq.${rootAccountId},root_account_id.eq.${rootAccountId}`)

  if (chainResp.error) {
    throw new PanelApiError(chainResp.error.message, 500)
  }

  for (const row of (chainResp.data || []) as Array<{ id: string }>) {
    accountIds.add(row.id)
  }

  if (params.account.account_email) {
    const emailResp = await params.supabaseAdmin
      .from('service_accounts')
      .select('id')
      .eq('owner_id', params.account.owner_id)
      .eq('account_email', params.account.account_email)

    if (emailResp.error) {
      throw new PanelApiError(emailResp.error.message, 500)
    }

    for (const row of (emailResp.data || []) as Array<{ id: string }>) {
      accountIds.add(row.id)
    }
  }

  const activeResp = await params.supabaseAdmin
    .from('support_requests')
    .select('id, requester_id')
    .in('account_id', [...accountIds])
    .neq('status', 'cerrada')
    .limit(1)
    .maybeSingle()

  if (activeResp.error) {
    throw new PanelApiError(activeResp.error.message, 500)
  }

  const existingRequest = (activeResp.data || null) as { id: string; requester_id: string } | null

  if (existingRequest?.id) {
    const message =
      existingRequest.requester_id === params.requesterId
        ? 'Ya tienes un soporte activo para esta cuenta.'
        : 'Esta cuenta ya tiene un soporte activo en tu cadena de clientes.'

    throw new PanelApiError(message, 409)
  }
}

async function replaceAccountEmailForChain(params: {
  account: AccountRow
  accountEmail: string
  actorId: string
  requestId: string
  requesterId: string
  supabaseAdmin: SupabaseAdminClient
}) {
  const rootAccountId = params.account.root_account_id || params.account.id
  const now = new Date().toISOString()
  const updateAccountResp = await params.supabaseAdmin
    .from('service_accounts')
    .update({
      account_email: params.accountEmail,
      updated_at: now,
    } as never)
    .eq('owner_id', params.account.owner_id)
    .or(`id.eq.${rootAccountId},root_account_id.eq.${rootAccountId}`)
    .select('id')

  if (updateAccountResp.error) {
    throw new PanelApiError(updateAccountResp.error.message, 500)
  }

  if ((updateAccountResp.data || []).length === 0) {
    throw new PanelApiError('No se encontro la cuenta para reemplazar.', 404)
  }

  const messageResp = await params.supabaseAdmin.from('support_messages').insert({
    request_id: params.requestId,
    sender_id: params.account.owner_id,
    sender_role: 'owner',
    body: `Reemplazo automatico listo: ${params.accountEmail}`,
  } as never)

  if (messageResp.error) {
    throw new PanelApiError(messageResp.error.message, 500)
  }

  const requesterResp = await params.supabaseAdmin
    .from('profiles')
    .select('id, username, parent_id')
    .eq('id', params.requesterId)
    .maybeSingle()

  const requester = (requesterResp.data || null) as {
    id: string
    username?: string | null
    parent_id?: string | null
  } | null
  const historyRequesterIds = Array.from(
    new Set([params.requesterId, requester?.parent_id].filter(Boolean) as string[])
  )

  if (historyRequesterIds.length > 0) {
    await params.supabaseAdmin.from('support_request_history').insert(
      historyRequesterIds.map(requesterId => ({
        account_email: params.accountEmail,
        service_name: params.account.service_name || null,
        requester_id: requesterId,
        owner_id: params.account.owner_id,
        request_kind: 'no_payment',
        subject: 'Reemplazo automatico entregado',
        description:
          requester?.parent_id && requesterId === requester.parent_id
            ? `Tu subcliente ${requester.username || 'subcliente'} abrio ticket por falta de pago y se le brindo reemplazo de la cuenta ${params.account.account_email || 'anterior'} por ${params.accountEmail}.`
            : `Se brindo reemplazo automatico de la cuenta ${params.account.account_email || 'anterior'} por ${params.accountEmail}.`,
        summary:
          requester?.parent_id && requesterId === requester.parent_id
            ? `Subcliente ${requester.username || 'subcliente'} recibio reemplazo: ${params.account.account_email || 'anterior'} -> ${params.accountEmail}`
            : `Reemplazo automatico: ${params.account.account_email || 'anterior'} -> ${params.accountEmail}`,
        message_count: 1,
        last_message_preview: `Reemplazo automatico listo: ${params.accountEmail}`,
        closed_by_id: params.actorId,
        created_at: now,
      })) as never
    )
  }
}

const getBranchIds = (rows: AccountRow[], startId: string) => {
  const ids = new Set<string>([startId])
  let changed = true
  while (changed) {
    changed = false
    for (const row of rows) {
      if (row.parent_account_id && ids.has(row.parent_account_id) && !ids.has(row.id)) {
        ids.add(row.id)
        changed = true
      }
    }
  }
  return Array.from(ids)
}

const normalizeHeader = (value: unknown) =>
  String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

const findHeaderIndex = (headers: unknown[], candidates: string[]) => {
  const normalized = headers.map(normalizeHeader)
  return normalized.findIndex(header => candidates.some(candidate => header === candidate || header.includes(candidate)))
}

const readStringCell = (value: unknown) => String(value || '').trim()

const toDateOnlyString = (date: Date) =>
  [
    String(date.getFullYear()).padStart(4, '0'),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-')

const parseExcelDate = (value: unknown) => {
  if (value === null || value === undefined || value === '') return null

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return toDateOnlyString(value)
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    const parsed = XLSX.SSF.parse_date_code(value)
    if (parsed?.y && parsed?.m && parsed?.d) {
      return `${String(parsed.y).padStart(4, '0')}-${String(parsed.m).padStart(2, '0')}-${String(parsed.d).padStart(2, '0')}`
    }
  }

  const raw = readStringCell(value)
  if (!raw) return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw

  const match = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/)
  if (match) {
    const [, day, month, year] = match
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
  }

  const parsed = new Date(raw)
  if (!Number.isNaN(parsed.getTime())) return toDateOnlyString(parsed)

  return null
}

const dataUrlToBuffer = (value: string) => {
  const base64 = value.includes(',') ? value.split(',').pop() || '' : value
  if (!base64.trim()) {
    throw new PanelApiError('Sube un archivo Excel valido.', 400)
  }
  return Buffer.from(base64, 'base64')
}

async function previewExcelAssignments(
  session: Awaited<ReturnType<typeof requirePanelSession>>,
  params: {
    fileDataUrl?: string
    serviceName?: string
    accountType?: string
  }
) {
  const workbook = XLSX.read(dataUrlToBuffer(String(params.fileDataUrl || '')), {
    type: 'buffer',
    cellDates: true,
  })
  const sheetName = workbook.SheetNames[0]
  const sheet = sheetName ? workbook.Sheets[sheetName] : null

  if (!sheet) {
    throw new PanelApiError('El Excel no tiene hojas para leer.', 400)
  }

  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '' })
  const headers = rows[0] || []
  const serviceIndex = findHeaderIndex(headers, ['servicio'])
  const emailIndex = findHeaderIndex(headers, ['cuenta', 'correo', 'email'])
  const typeIndex = findHeaderIndex(headers, ['tipo'])
  const clientIndex = findHeaderIndex(headers, ['cliente'])
  const cutoffIndex = findHeaderIndex(headers, ['corte', 'fecha corte', 'fecha de corte', 'vencimiento'])

  if (emailIndex === -1 || clientIndex === -1) {
    throw new PanelApiError('El Excel debe tener columnas Cuenta y Cliente.', 400)
  }

  const profilesResp = await session.supabaseAdmin.from('profiles').select('id, username')
  if (profilesResp.error) {
    throw new PanelApiError(profilesResp.error.message, 500)
  }

  const profileByUsername = new Map(
    ((profilesResp.data || []) as ProfileMiniRow[]).map(profile => [normalizeUsername(profile.username), profile])
  )

  const assignments: PreviewAssignment[] = []
  const omitted: PreviewOmitted[] = []
  const seen = new Set<string>()
  const fallbackServiceName = String(params.serviceName || 'Netflix').trim() || 'Netflix'
  const fallbackAccountType = String(params.accountType || 'Cuenta completa').trim() || 'Cuenta completa'

  rows.slice(1).forEach((row, index) => {
    const rowNumber = index + 2
    const email = readStringCell(row[emailIndex]).toLowerCase()
    const rawClient = readStringCell(row[clientIndex])
    const clientTone = rawClient.toLowerCase()

    if (!email || !email.includes('@')) {
      omitted.push({ email: email || `fila ${rowNumber}`, reason: 'correo invalido o vacio' })
      return
    }

    if (!rawClient || ['n/a', 'na', 'null', 'none', '-'].includes(clientTone)) {
      omitted.push({ email, reason: 'cliente vacio o N/A' })
      return
    }

    const username = normalizeUsername(rawClient.split('@')[0] || '')
    const validationError = validateUsername(username)
    if (validationError) {
      omitted.push({ email, reason: `cliente invalido: ${rawClient}` })
      return
    }

    const profile = profileByUsername.get(username)
    if (!profile?.id) {
      omitted.push({ email, reason: `usuario no existe: ${username}` })
      return
    }

    const cutoffDate = cutoffIndex >= 0 ? parseExcelDate(row[cutoffIndex]) : null
    const serviceName = serviceIndex >= 0 ? readStringCell(row[serviceIndex]) || fallbackServiceName : fallbackServiceName
    const accountType = typeIndex >= 0 ? readStringCell(row[typeIndex]) || fallbackAccountType : fallbackAccountType
    const key = `${profile.id}:${serviceName.toLowerCase()}:${email}`

    if (seen.has(key)) {
      omitted.push({ email, reason: `duplicado para ${username}` })
      return
    }

    seen.add(key)
    assignments.push({
      email,
      userId: profile.id,
      username: profile.username,
      cutoffDate,
      serviceName,
      accountType,
    })
  })

  return NextResponse.json({
    message: `Se asignaran ${assignments.length} cuentas.`,
    excelPreview: {
      totalRows: Math.max(rows.length - 1, 0),
      assignments,
      omitted,
    },
  })
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
        serviceName?: string
        accountType?: string
      }>
      fileDataUrl?: string
      serviceName?: string
      accountType?: string
      cutoffDate?: string
      renewalPrice?: number
      renewalPeriodDays?: number
      status?: string
      nextEmail?: string
    }

    const action = String(body.action || '').trim()

    if (action === 'preview_excel') {
      const session = await requirePanelSession(request, true)
      return await previewExcelAssignments(session, body)
    }

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
                serviceName: String(item.serviceName || body.serviceName || 'Netflix').trim() || 'Netflix',
                accountType: String(item.accountType || body.accountType || 'Cuenta completa').trim() || 'Cuenta completa',
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
              serviceName: String(body.serviceName || 'Netflix').trim() || 'Netflix',
              accountType: String(body.accountType || 'Cuenta completa').trim() || 'Cuenta completa',
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
          assignments.map(item => [`${item.userId}:${item.serviceName || serviceName}:${item.accountEmail}`, item])
        ).values()
      )

      const rows = uniqueAssignments.map(item => ({
        owner_id: session.profile.id,
        assigned_user_id: item.userId,
        assigned_by_id: session.profile.id,
        parent_account_id: null,
        root_account_id: null,
        assignment_depth: 0,
        service_name: item.serviceName || serviceName,
        account_email: item.accountEmail,
        account_type: item.accountType || accountType,
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
          'id, owner_id, assigned_user_id, assigned_by_id, parent_account_id, root_account_id, assignment_depth, service_name, account_email, account_type, cutoff_date, renewal_price, renewal_period_days, status, created_at, updated_at'
        )

      if (upsertResp.error) {
        throw new PanelApiError(upsertResp.error.message, 500)
      }

      const savedRows = (upsertResp.data || []) as AccountRow[]
      if (savedRows.length === 0) {
        throw new PanelApiError('Supabase no devolvio cuentas guardadas.', 500)
      }

      const rowsWithoutRoot = savedRows.filter(row => !row.root_account_id)
      if (rowsWithoutRoot.length > 0) {
        await Promise.all(
          rowsWithoutRoot.map(row =>
            session.supabaseAdmin
              .from('service_accounts')
              .update({ root_account_id: row.id } as never)
              .eq('id', row.id)
          )
        )
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

    if (action === 'delegate') {
      const session = await requirePanelSession(request)
      const accountId = String(body.accountId || '').trim()
      const targetUserId = String(body.userId || '').trim()
      const cutoffDate = parseNullableDate(body.cutoffDate)

      if (!accountId || !targetUserId) {
        throw new PanelApiError('Selecciona una cuenta y un subcliente.', 400)
      }

      const accountResp = await session.supabaseAdmin
        .from('service_accounts')
        .select(
          'id, owner_id, assigned_user_id, assigned_by_id, parent_account_id, root_account_id, assignment_depth, service_name, account_email, account_type, cutoff_date, renewal_price, renewal_period_days, status, created_at, updated_at'
        )
        .eq('id', accountId)
        .eq('assigned_user_id', session.profile.id)
        .maybeSingle()

      if (accountResp.error) {
        throw new PanelApiError(accountResp.error.message, 500)
      }

      const sourceAccount = (accountResp.data || null) as AccountRow | null
      if (!sourceAccount?.id) {
        throw new PanelApiError('Solo puedes asignar cuentas que tengas en tu panel.', 403)
      }

      const targetResp = await session.supabaseAdmin
        .from('profiles')
        .select('id, username, parent_id, created_by_id')
        .eq('id', targetUserId)
        .maybeSingle()

      if (targetResp.error) {
        throw new PanelApiError(targetResp.error.message, 500)
      }

      const targetUser = (targetResp.data || null) as ProfileMiniRow | null
      if (!targetUser?.id) {
        throw new PanelApiError('Ese subcliente no existe.', 404)
      }

      if (targetUser.parent_id !== session.profile.id && targetUser.created_by_id !== session.profile.id) {
        throw new PanelApiError('Solo puedes asignar cuentas a tus subclientes directos.', 403)
      }

      const rootAccountId = sourceAccount.root_account_id || sourceAccount.id
      const currentDepth = Number(sourceAccount.assignment_depth || 0)
      if (currentDepth >= 5) {
        throw new PanelApiError('Esta cuenta ya llego al limite de 5 niveles de asignacion.', 400)
      }

      const duplicateResp = await session.supabaseAdmin
        .from('service_accounts')
        .select('id')
        .eq('assigned_user_id', targetUser.id)
        .eq('root_account_id', rootAccountId)
        .limit(1)

      if (duplicateResp.error) {
        throw new PanelApiError(duplicateResp.error.message, 500)
      }

      if ((duplicateResp.data || []).length > 0) {
        throw new PanelApiError('Ese subcliente ya tiene esa misma cuenta.', 409)
      }

      const sharedEmailResp = await session.supabaseAdmin
        .from('service_accounts')
        .select('id')
        .eq('assigned_by_id', session.profile.id)
        .eq('account_email', sourceAccount.account_email || '')
        .neq('assigned_user_id', targetUser.id)
        .limit(1)

      if (sharedEmailResp.error) {
        throw new PanelApiError(sharedEmailResp.error.message, 500)
      }

      if ((sharedEmailResp.data || []).length > 0) {
        throw new PanelApiError('Ese correo ya fue asignado a otro subcliente. No se puede repetir.', 409)
      }

      const branchCountResp = await session.supabaseAdmin
        .from('service_accounts')
        .select('id', { count: 'exact', head: true })
        .eq('root_account_id', rootAccountId)
        .neq('id', rootAccountId)

      if (branchCountResp.error) {
        throw new PanelApiError(branchCountResp.error.message, 500)
      }

      if ((branchCountResp.count || 0) >= 5) {
        throw new PanelApiError('Esta cuenta ya fue asignada 5 veces.', 400)
      }

      const insertResp = await session.supabaseAdmin
        .from('service_accounts')
        .insert({
          owner_id: sourceAccount.owner_id,
          assigned_user_id: targetUser.id,
          assigned_by_id: session.profile.id,
          parent_account_id: sourceAccount.id,
          root_account_id: rootAccountId,
          assignment_depth: currentDepth + 1,
          service_name: sourceAccount.service_name || 'Netflix',
          account_email: sourceAccount.account_email || '',
          account_type: sourceAccount.account_type || 'Cuenta completa',
          cutoff_date: cutoffDate || sourceAccount.cutoff_date || null,
          renewal_price: parseMoney(sourceAccount.renewal_price, 0),
          renewal_period_days: Number(sourceAccount.renewal_period_days || 30),
          status: 'activa',
          updated_at: new Date().toISOString(),
        } as never)
        .select(
          'id, owner_id, assigned_user_id, assigned_by_id, parent_account_id, root_account_id, assignment_depth, service_name, account_email, account_type, cutoff_date, renewal_price, renewal_period_days, status, created_at, updated_at'
        )
        .maybeSingle()

      if (insertResp.error) {
        throw new PanelApiError(insertResp.error.message, 500)
      }

      const savedRow = insertResp.data as AccountRow | null
      if (!savedRow?.id) {
        throw new PanelApiError('Supabase no devolvio la cuenta delegada.', 500)
      }

      return NextResponse.json({
        message: 'Cuenta asignada al subcliente.',
        ids: [savedRow.id],
        accounts: [
          mapAssignedAccount({
            row: savedRow as Required<Pick<AccountRow, 'id' | 'owner_id' | 'assigned_user_id'>> & AccountRow,
            ownerUsername: session.profile.username,
          }),
        ],
      })
    }

    if (action === 'remove') {
      const session = await requirePanelSession(request)
      const accountId = String(body.accountId || '').trim()
      if (!accountId) {
        throw new PanelApiError('Cuenta no valida.', 400)
      }

      const accountChainResp = await session.supabaseAdmin
        .from('service_accounts')
        .select('id, owner_id, assigned_by_id, parent_account_id, root_account_id')
        .eq('id', accountId)
        .maybeSingle()

      if (accountChainResp.error) {
        throw new PanelApiError(accountChainResp.error.message, 500)
      }

      const accountChain = (accountChainResp.data || null) as {
        id: string
        owner_id: string
        assigned_by_id?: string | null
        parent_account_id?: string | null
        root_account_id?: string | null
      } | null

      if (!accountChain?.id) {
        throw new PanelApiError('Cuenta no encontrada.', 404)
      }

      if (accountChain.owner_id !== session.profile.id && accountChain.assigned_by_id !== session.profile.id) {
        throw new PanelApiError('No puedes quitar esa cuenta.', 403)
      }

      const rootAccountId = accountChain.root_account_id || accountChain.id
      const scopeResp = await session.supabaseAdmin
        .from('service_accounts')
        .select('id, parent_account_id, root_account_id')
        .or(`id.eq.${rootAccountId},root_account_id.eq.${rootAccountId}`)

      if (scopeResp.error) {
        throw new PanelApiError(scopeResp.error.message, 500)
      }

      const scopedRows = (scopeResp.data || []) as AccountRow[]
      const idsToDelete =
        accountChain.owner_id === session.profile.id
          ? scopedRows.map(row => row.id)
          : getBranchIds(scopedRows, accountId)

      const deleteResp = await session.supabaseAdmin
        .from('service_accounts')
        .delete()
        .in('id', idsToDelete)
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

    if (action === 'update') {
      const session = await requirePanelSession(request)
      const accountId = String(body.accountId || '').trim()
      const nextEmail = String(body.nextEmail || '').trim().toLowerCase()
      const cutoffDate = parseNullableDate(body.cutoffDate)
      const renewalPrice = parseMoney(body.renewalPrice, 0)
      const renewalPeriodDays = Math.max(1, Number(body.renewalPeriodDays || 30) || 30)
      const status = String(body.status || 'activa').trim() as ServiceAccountStatus

      if (!accountId) {
        throw new PanelApiError('Cuenta no valida.', 400)
      }

      if (!ACCOUNT_STATUSES.has(status)) {
        throw new PanelApiError('Estado de cuenta no valido.', 400)
      }

      const accountResp = await session.supabaseAdmin
        .from('service_accounts')
        .select(
          'id, owner_id, assigned_user_id, assigned_by_id, parent_account_id, root_account_id, account_email, service_name, account_type, cutoff_date, renewal_price, renewal_period_days, status'
        )
        .eq('id', accountId)
        .maybeSingle()

      if (accountResp.error) {
        throw new PanelApiError(accountResp.error.message, 500)
      }

      const account = (accountResp.data || null) as AccountRow | null
      if (!account?.id) {
        throw new PanelApiError('No se encontro la cuenta para editar.', 404)
      }

      const isOwnerEditor = account.owner_id === session.profile.id && session.profile.role === 'owner'
      const isDelegatedEditor = account.assigned_by_id === session.profile.id
      if (!isOwnerEditor && !isDelegatedEditor) {
        throw new PanelApiError('No puedes editar esta cuenta.', 403)
      }

      if (isOwnerEditor && (!nextEmail || !nextEmail.includes('@'))) {
        throw new PanelApiError('Ingresa un correo valido.', 400)
      }

      const serviceName = isOwnerEditor
        ? String(body.serviceName || account.service_name || 'Netflix').trim() || 'Netflix'
        : account.service_name || 'Netflix'
      const accountType = isOwnerEditor
        ? String(body.accountType || account.account_type || 'Cuenta completa').trim() || 'Cuenta completa'
        : account.account_type || 'Cuenta completa'
      const accountEmail = isOwnerEditor ? nextEmail : account.account_email || ''
      const rootAccountId = account.root_account_id || account.id
      const scopeResp = await session.supabaseAdmin
        .from('service_accounts')
        .select('id, parent_account_id, root_account_id')
        .or(`id.eq.${rootAccountId},root_account_id.eq.${rootAccountId}`)

      if (scopeResp.error) {
        throw new PanelApiError(scopeResp.error.message, 500)
      }

      const scopedRows = (scopeResp.data || []) as AccountRow[]
      const idsToUpdate = isOwnerEditor ? scopedRows.map(row => row.id) : getBranchIds(scopedRows, accountId)
      const now = new Date().toISOString()
      const updateResp = await session.supabaseAdmin
        .from('service_accounts')
        .update({
          service_name: serviceName,
          account_email: accountEmail,
          account_type: accountType,
          cutoff_date: cutoffDate,
          renewal_price: renewalPrice,
          renewal_period_days: renewalPeriodDays,
          status,
          updated_at: now,
        } as never)
        .in('id', idsToUpdate)
        .select(
          'id, owner_id, assigned_user_id, assigned_by_id, parent_account_id, root_account_id, assignment_depth, service_name, account_email, account_type, cutoff_date, renewal_price, renewal_period_days, status, created_at, updated_at'
        )

      if (updateResp.error) {
        throw new PanelApiError(updateResp.error.message, 500)
      }

      const updatedRows = (updateResp.data || []) as AccountRow[]
      if (updatedRows.length === 0) {
        throw new PanelApiError('No se actualizo ninguna cuenta.', 404)
      }

      const requesterIds = Array.from(
        new Set([session.profile.id, ...updatedRows.map(row => row.assigned_user_id)].filter(Boolean))
      )
      const historyRows = requesterIds.map(requesterId => ({
        account_email: accountEmail,
        service_name: serviceName,
        requester_id: requesterId,
        owner_id: account.owner_id,
        request_kind: 'issue',
        subject: 'Cuenta actualizada',
        description: isOwnerEditor
          ? `Se actualizo la cuenta ${account.account_email || 'anterior'} por ${accountEmail}.`
          : `Se actualizo fecha de corte o datos de renovacion de ${serviceName}.`,
        summary: isOwnerEditor
          ? `Cuenta actualizada: ${account.account_email || 'anterior'} -> ${accountEmail}`
          : `Datos de cuenta actualizados por ${session.profile.username}.`,
        message_count: 0,
        last_message_preview: `El proveedor actualizo datos de ${serviceName}.`,
        closed_by_id: session.profile.id,
        created_at: now,
      }))

      if (historyRows.length > 0) {
        await session.supabaseAdmin.from('support_request_history').insert(historyRows as never)
      }

      return NextResponse.json({
        message: 'Cuenta actualizada para toda la cadena.',
        accounts: updatedRows.map(row =>
          mapAssignedAccount({
            row: row as Required<Pick<AccountRow, 'id' | 'owner_id' | 'assigned_user_id'>> & AccountRow,
            ownerUsername: isOwnerEditor ? session.profile.username : 'owner',
          })
        ),
      })
    }

    const session = await requirePanelSession(request)
    const accountId = String(body.accountId || '').trim()

    if (!accountId) {
      throw new PanelApiError('Cuenta no valida.', 400)
    }

    const accountResp = await session.supabaseAdmin
      .from('service_accounts')
      .select(
        'id, owner_id, assigned_user_id, root_account_id, service_name, account_email, account_type, renewal_price'
      )
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

      await ensureNoActiveSupportRequest({
        account,
        requesterId: session.profile.id,
        supabaseAdmin: session.supabaseAdmin,
      })

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
      await ensureNoActiveSupportRequest({
        account,
        requesterId: session.profile.id,
        supabaseAdmin: session.supabaseAdmin,
      })

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
      let responseMessage = 'Solicitud de pago reportada.'

      if (insertedRequest?.id && account.account_email) {
        try {
          const autoReplacement = await resolveSdnetpanelNoPaymentReplacement({
            accountEmail: account.account_email,
          })

          if (autoReplacement.status === 'replaced') {
            await replaceAccountEmailForChain({
              account,
              accountEmail: autoReplacement.replacementEmail,
              actorId: session.profile.id,
              requestId: insertedRequest.id,
              requesterId: session.profile.id,
              supabaseAdmin: session.supabaseAdmin,
            })

            await session.supabaseAdmin
              .from('support_requests')
              .update({
                status: 'cierre_solicitado',
              } as never)
              .eq('id', insertedRequest.id)

            responseMessage = 'SDPanel entrego reemplazo automatico. Confirma el cierre cuando todo este conforme.'
          } else {
            await session.supabaseAdmin.from('support_messages').insert({
              request_id: insertedRequest.id,
              sender_id: account.owner_id,
              sender_role: 'owner',
              body:
                autoReplacement.providerMessage ||
                'En unos momentos el proveedor te atendera. Por ahora estamos sin reemplazos disponibles, pero ya quedo reportado.',
            } as never)

            await session.supabaseAdmin
              .from('support_requests')
              .update({
                status: 'en_chat',
              } as never)
              .eq('id', insertedRequest.id)

            responseMessage = 'Solicitud enviada. En unos momentos el proveedor le atendera.'
          }
        } catch {
          await session.supabaseAdmin.from('support_messages').insert({
            request_id: insertedRequest.id,
            sender_id: account.owner_id,
            sender_role: 'owner',
            body:
              'En unos momentos el proveedor te atendera. Por ahora estamos sin reemplazos disponibles, pero ya quedo reportado.',
          } as never)

          await session.supabaseAdmin
            .from('support_requests')
            .update({
              status: 'en_chat',
            } as never)
            .eq('id', insertedRequest.id)
        }
      }

      return NextResponse.json({
        message: responseMessage,
        requestId: insertedRequest?.id || null,
      })
    }

    if (action === 'renewal') {
      if (session.profile.parentId) {
        throw new PanelApiError('Los subclientes no pueden solicitar renovacion.', 403)
      }

      const paymentProofDataUrl = normalizeDataUrlImage(body.paymentProofDataUrl)

      await ensureNoActiveSupportRequest({
        account,
        requesterId: session.profile.id,
        supabaseAdmin: session.supabaseAdmin,
      })

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
