import { type NextRequest } from 'next/server'
import { getSupabaseAdmin } from './supabaseAdmin'

type ServiceAccountAccessRow = {
  id: string
  assigned_user_id: string | null
  account_email: string | null
  status: string | null
}

type ProfileRoleRow = {
  role: string | null
}

export class CodesAccessError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'CodesAccessError'
    this.status = status
  }
}

export async function enforceCodesRecipientAccess(params: {
  request: NextRequest
  recipient: string
}) {
  let supabaseAdmin: ReturnType<typeof getSupabaseAdmin>

  try {
    supabaseAdmin = getSupabaseAdmin()
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Supabase admin no configurado'
    throw new CodesAccessError(message, 500)
  }

  const authHeader = params.request.headers.get('authorization') || ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : ''
  if (!token) {
    throw new CodesAccessError('Necesitas iniciar sesion para consultar tus correos asignados.', 401)
  }

  const { data: userResp, error: userError } = await supabaseAdmin.auth.getUser(token)
  if (userError || !userResp?.user) {
    throw new CodesAccessError('Sesion invalida.', 401)
  }

  const userId = userResp.user.id
  const { data: profile, error: profileError } = await supabaseAdmin
    .from('profiles')
    .select('role')
    .eq('id', userId)
    .maybeSingle()

  if (profileError) {
    throw new CodesAccessError(profileError.message, 500)
  }

  if (((profile || null) as ProfileRoleRow | null)?.role === 'owner') {
    return {
      mode: 'owner' as const,
      userId,
    }
  }

  const { data: accounts, error: accountsError } = await supabaseAdmin
    .from('service_accounts')
    .select('id, assigned_user_id, account_email, status')
    .eq('assigned_user_id', userId)
    .order('created_at', { ascending: false })
    .limit(500)

  if (accountsError) {
    throw new CodesAccessError(accountsError.message, 500)
  }

  const recipientLower = params.recipient.toLowerCase()
  const accountRows = (accounts ?? []) as ServiceAccountAccessRow[]
  const hasAccess =
    accountRows.some(account => {
      const email = String(account.account_email || '').trim().toLowerCase()
      return email === recipientLower
    }) || false

  if (!hasAccess) {
    throw new CodesAccessError(
      'Este correo no esta dentro de tus cuentas asignadas.',
      403
    )
  }

  return {
    mode: 'session' as const,
    userId,
  }
}
