import { NextRequest } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabaseAdmin'
import type { PanelProfile } from '@/lib/panel-types'

type ProfileRow = {
  id: string
  username: string
  role: 'usuario' | 'owner'
  phone: string | null
  telegram: string | null
  created_at: string
}

export class PanelApiError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.status = status
    this.name = 'PanelApiError'
  }
}

export async function requirePanelSession(request: NextRequest, requireOwner = false) {
  const supabaseAdmin = getSupabaseAdmin()
  const authHeader = request.headers.get('authorization') || ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : ''

  if (!token) {
    throw new PanelApiError('Sesion no encontrada.', 401)
  }

  const userResp = await supabaseAdmin.auth.getUser(token)
  if (userResp.error || !userResp.data.user) {
    throw new PanelApiError('Sesion invalida.', 401)
  }

  const profileResp = await supabaseAdmin
    .from('profiles')
    .select('id, username, role, phone, telegram, created_at')
    .eq('id', userResp.data.user.id)
    .maybeSingle()

  if (profileResp.error) {
    throw new PanelApiError(profileResp.error.message, 500)
  }

  const profileRow = profileResp.data as ProfileRow | null
  if (!profileRow?.id) {
    throw new PanelApiError('No se encontro tu perfil.', 404)
  }

  const profile: PanelProfile = {
    id: profileRow.id,
    username: profileRow.username,
    role: profileRow.role === 'owner' ? 'owner' : 'usuario',
    phone: profileRow.phone,
    telegram: profileRow.telegram,
    createdAt: profileRow.created_at,
  }

  if (requireOwner && profile.role !== 'owner') {
    throw new PanelApiError('Solo los owner pueden usar esta accion.', 403)
  }

  return {
    supabaseAdmin,
    authUser: userResp.data.user,
    profile,
    token,
  }
}
