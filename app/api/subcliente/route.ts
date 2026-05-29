import { randomBytes } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getSupabaseAdmin } from '@/lib/supabaseAdmin'
import { PanelApiError, requirePanelSession } from '@/lib/panel-auth'
import {
  buildPhoneNumber,
  normalizePhoneCountry,
  normalizePhoneDigits,
  normalizeUsername,
  usernameToAuthEmail,
  validatePassword,
  validatePhone,
  validateUsername,
} from '@/lib/auth-identity'
import { hashSecurityPin, normalizeSecurityPin, validateSecurityPin } from '@/lib/security-pin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type SubclienteProfileRow = {
  id: string
  username: string
  phone: string | null
  security_pin_hash: string | null
  onboarding_status?: string | null
  created_by_id?: string | null
  parent_id?: string | null
}

type CreatorRow = {
  id: string
  role: 'usuario' | 'owner'
}

const getPublicClient = () => {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new PanelApiError('Supabase no esta configurado.', 500)
  }

  return createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })
}

const createPlaceholderPhone = (seed = '') => {
  const rawDigits = `${seed}${randomBytes(8).toString('hex')}`.replace(/\D/g, '')
  const digits = rawDigits.padEnd(14, '0').slice(0, 14)
  return `+1${digits}`
}

const createTemporaryPassword = () => `${randomBytes(24).toString('base64url')}aA1!`

const getCreatorRole = async (createdById: string | null | undefined) => {
  if (!createdById) return 'usuario'

  const supabaseAdmin = getSupabaseAdmin()
  const creatorResp = await supabaseAdmin
    .from('profiles')
    .select('id, role')
    .eq('id', createdById)
    .maybeSingle()

  if (creatorResp.error) {
    throw new PanelApiError(creatorResp.error.message, 500)
  }

  const creator = (creatorResp.data || null) as CreatorRow | null
  return creator?.role === 'owner' ? 'owner' : 'usuario'
}

const findProfileByUsername = async (username: string) => {
  const supabaseAdmin = getSupabaseAdmin()
  const profileResp = await supabaseAdmin
    .from('profiles')
    .select('id, username, phone, security_pin_hash, onboarding_status, created_by_id, parent_id')
    .eq('username', username)
    .maybeSingle()

  if (profileResp.error) {
    throw new PanelApiError(profileResp.error.message, 500)
  }

  return (profileResp.data || null) as SubclienteProfileRow | null
}

async function createPendingUser(request: NextRequest, username: string) {
  const session = await requirePanelSession(request)
  const supabaseAdmin = session.supabaseAdmin

  const validationError = validateUsername(username)
  if (validationError) {
    throw new PanelApiError(validationError, 400)
  }

  const existingProfile = await findProfileByUsername(username)
  if (existingProfile?.id) {
    throw new PanelApiError('Ese nombre de usuario ya existe.', 409)
  }

  const placeholderPhone = createPlaceholderPhone(username)
  const placeholderPinHash = hashSecurityPin('0000')

  const createdUser = await supabaseAdmin.auth.admin.createUser({
    email: usernameToAuthEmail(username),
    password: createTemporaryPassword(),
    email_confirm: true,
    user_metadata: {
      username,
      phone: placeholderPhone,
      security_pin_hash: placeholderPinHash,
      onboarding_status: 'pending',
      created_by_id: session.profile.id,
      parent_id: session.profile.role === 'owner' ? null : session.profile.id,
    },
  })

  if (createdUser.error || !createdUser.data.user?.id) {
    const message = createdUser.error?.message || 'No se pudo crear el usuario pendiente.'
    throw new PanelApiError(message, 400)
  }

  const userId = createdUser.data.user.id
  const profileResp = await supabaseAdmin
    .from('profiles')
    .upsert(
      {
        id: userId,
        username,
        phone: placeholderPhone,
        telegram: null,
        role: 'usuario',
        security_pin_hash: placeholderPinHash,
        onboarding_status: 'pending',
        created_by_id: session.profile.id,
        parent_id: session.profile.role === 'owner' ? null : session.profile.id,
        updated_at: new Date().toISOString(),
      } as never,
      { onConflict: 'id' }
    )
    .select('id, username')
    .maybeSingle()

  if (profileResp.error) {
    await supabaseAdmin.auth.admin.deleteUser(userId)
    throw new PanelApiError(profileResp.error.message, 500)
  }

  return NextResponse.json({
    message: 'Usuario pendiente creado.',
    user: profileResp.data,
  })
}

async function lookupUser(username: string) {
  const validationError = validateUsername(username)
  if (validationError) {
    throw new PanelApiError(validationError, 400)
  }

  const profile = await findProfileByUsername(username)
  if (!profile?.id) {
    throw new PanelApiError('Ese usuario aun no fue creado por su proveedor.', 404)
  }

  const creatorRole = await getCreatorRole(profile.created_by_id)
  const pending = (profile.onboarding_status || 'active') === 'pending'
  if (!pending && !profile.created_by_id && !profile.parent_id) {
    throw new PanelApiError('Este usuario debe iniciar sesion desde la pantalla principal.', 400)
  }

  return NextResponse.json({
    username: profile.username,
    mode: pending ? 'complete' : 'login',
    createdByOwner: creatorRole === 'owner',
  })
}

async function completeUser(body: {
  username?: string
  password?: string
  phoneCountry?: string
  phoneDigits?: string
  securityPin?: string
}) {
  const username = normalizeUsername(body.username || '')
  const password = body.password || ''
  const phoneCountry = normalizePhoneCountry(body.phoneCountry || '')
  const phoneDigits = normalizePhoneDigits(body.phoneDigits || '')
  const phone = buildPhoneNumber(phoneCountry, phoneDigits)
  const securityPin = normalizeSecurityPin(body.securityPin || '')

  const validationError =
    validateUsername(username) ||
    validatePassword(password) ||
    validatePhone(phoneCountry, phoneDigits) ||
    validateSecurityPin(securityPin)

  if (validationError) {
    throw new PanelApiError(validationError, 400)
  }

  const profile = await findProfileByUsername(username)
  if (!profile?.id) {
    throw new PanelApiError('Ese usuario aun no fue creado por su proveedor.', 404)
  }

  if ((profile.onboarding_status || 'active') !== 'pending') {
    throw new PanelApiError('Ese usuario ya termino su registro. Inicia sesion.', 409)
  }

  const supabaseAdmin = getSupabaseAdmin()
  const existingPhone = await supabaseAdmin
    .from('profiles')
    .select('id')
    .eq('phone', phone)
    .neq('id', profile.id)
    .limit(1)

  if (existingPhone.error) {
    throw new PanelApiError(existingPhone.error.message, 500)
  }

  if ((existingPhone.data || []).length > 0) {
    throw new PanelApiError('Ese numero de telefono ya esta registrado.', 409)
  }

  const securityPinHash = hashSecurityPin(securityPin)
  const updateUserResp = await supabaseAdmin.auth.admin.updateUserById(profile.id, {
    password,
    user_metadata: {
      username,
      phone,
      security_pin_hash: securityPinHash,
      onboarding_status: 'active',
      created_by_id: profile.created_by_id || null,
      parent_id: profile.parent_id || null,
    },
  })

  if (updateUserResp.error) {
    throw new PanelApiError(updateUserResp.error.message, 400)
  }

  const profileResp = await supabaseAdmin
    .from('profiles')
    .update({
      phone,
      security_pin_hash: securityPinHash,
      onboarding_status: 'active',
      updated_at: new Date().toISOString(),
    } as never)
    .eq('id', profile.id)

  if (profileResp.error) {
    throw new PanelApiError(profileResp.error.message, 500)
  }

  const creatorRole = await getCreatorRole(profile.created_by_id)
  if (creatorRole !== 'owner') {
    return NextResponse.json({
      message: 'Registro completado. Ahora inicia sesion.',
      needsLogin: true,
    })
  }

  const signInResp = await getPublicClient().auth.signInWithPassword({
    email: usernameToAuthEmail(username),
    password,
  })

  if (signInResp.error || !signInResp.data.session) {
    throw new PanelApiError('Registro completado, pero no se pudo iniciar sesion automaticamente.', 401)
  }

  return NextResponse.json({
    message: 'Registro completado.',
    redirectPanel: true,
    session: {
      access_token: signInResp.data.session.access_token,
      refresh_token: signInResp.data.session.refresh_token,
    },
  })
}

async function loginUser(body: {
  username?: string
  password?: string
  securityPin?: string
}) {
  const username = normalizeUsername(body.username || '')
  const password = body.password || ''
  const securityPin = normalizeSecurityPin(body.securityPin || '')

  const validationError = validateUsername(username) || validatePassword(password) || validateSecurityPin(securityPin)
  if (validationError) {
    throw new PanelApiError(validationError, 400)
  }

  const profile = await findProfileByUsername(username)
  if (!profile?.id || (profile.onboarding_status || 'active') === 'pending') {
    throw new PanelApiError('Termina tu registro antes de iniciar sesion.', 401)
  }

  if (!profile.created_by_id && !profile.parent_id) {
    throw new PanelApiError('Este usuario debe iniciar sesion desde la pantalla principal.', 400)
  }

  if (!profile.security_pin_hash || profile.security_pin_hash !== hashSecurityPin(securityPin)) {
    throw new PanelApiError('Codigo de seguridad invalido.', 401)
  }

  const signInResp = await getPublicClient().auth.signInWithPassword({
    email: usernameToAuthEmail(username),
    password,
  })

  if (signInResp.error || !signInResp.data.session) {
    throw new PanelApiError('Datos de acceso invalidos.', 401)
  }

  return NextResponse.json({
    session: {
      access_token: signInResp.data.session.access_token,
      refresh_token: signInResp.data.session.refresh_token,
    },
  })
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      action?: string
      password?: string
      phoneCountry?: string
      phoneDigits?: string
      securityPin?: string
      username?: string
    }

    const action = String(body.action || '').trim()
    const username = normalizeUsername(body.username || '')

    if (action === 'create_pending') {
      return await createPendingUser(request, username)
    }

    if (action === 'lookup') {
      return await lookupUser(username)
    }

    if (action === 'complete') {
      return await completeUser(body)
    }

    if (action === 'login') {
      return await loginUser(body)
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
