import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { usernameToAuthEmail, validatePassword } from '@/lib/auth-identity'
import { PanelApiError, requirePanelSession } from '@/lib/panel-auth'
import { hashSecurityPin, normalizeSecurityPin, validateSecurityPin } from '@/lib/security-pin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type SettingsProfileRow = {
  security_pin_hash: string
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

async function assertCurrentPassword(username: string, currentPassword: string) {
  const passwordError = validatePassword(currentPassword)
  if (passwordError) {
    throw new PanelApiError(passwordError, 400)
  }

  const signInResp = await getPublicClient().auth.signInWithPassword({
    email: usernameToAuthEmail(username),
    password: currentPassword,
  })

  if (signInResp.error || !signInResp.data.session) {
    throw new PanelApiError('Contrasena actual invalida.', 401)
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      action?: string
      currentPassword?: string
      currentPin?: string
      nextPassword?: string
      nextPasswordConfirm?: string
      nextPin?: string
      nextPinConfirm?: string
    }

    const session = await requirePanelSession(request)
    const action = String(body.action || '').trim()

    if (action === 'password') {
      const currentPassword = String(body.currentPassword || '')
      const nextPassword = String(body.nextPassword || '')
      const nextPasswordConfirm = String(body.nextPasswordConfirm || '')

      const nextPasswordError = validatePassword(nextPassword)
      if (nextPasswordError) {
        throw new PanelApiError(nextPasswordError, 400)
      }

      if (nextPassword !== nextPasswordConfirm) {
        throw new PanelApiError('La nueva contrasena no coincide.', 400)
      }

      if (currentPassword === nextPassword) {
        throw new PanelApiError('La nueva contrasena debe ser diferente.', 400)
      }

      await assertCurrentPassword(session.profile.username, currentPassword)

      const updateResp = await session.supabaseAdmin.auth.admin.updateUserById(session.profile.id, {
        password: nextPassword,
      })

      if (updateResp.error) {
        throw new PanelApiError(updateResp.error.message, 500)
      }

      return NextResponse.json({ message: 'Contrasena actualizada.' })
    }

    if (action === 'pin') {
      const currentPin = normalizeSecurityPin(body.currentPin || '')
      const nextPin = normalizeSecurityPin(body.nextPin || '')
      const nextPinConfirm = normalizeSecurityPin(body.nextPinConfirm || '')

      const pinError =
        validateSecurityPin(currentPin) ||
        validateSecurityPin(nextPin) ||
        validateSecurityPin(nextPinConfirm)

      if (pinError) {
        throw new PanelApiError(pinError, 400)
      }

      if (nextPin !== nextPinConfirm) {
        throw new PanelApiError('El codigo nuevo no coincide.', 400)
      }

      if (currentPin === nextPin) {
        throw new PanelApiError('El codigo nuevo debe ser diferente.', 400)
      }

      const profileResp = await session.supabaseAdmin
        .from('profiles')
        .select('security_pin_hash')
        .eq('id', session.profile.id)
        .maybeSingle()

      if (profileResp.error) {
        throw new PanelApiError(profileResp.error.message, 500)
      }

      const profile = profileResp.data as SettingsProfileRow | null
      if (!profile?.security_pin_hash || profile.security_pin_hash !== hashSecurityPin(currentPin)) {
        throw new PanelApiError('Codigo actual invalido.', 401)
      }

      const updateResp = await session.supabaseAdmin
        .from('profiles')
        .update({
          security_pin_hash: hashSecurityPin(nextPin),
          updated_at: new Date().toISOString(),
        } as never)
        .eq('id', session.profile.id)

      if (updateResp.error) {
        throw new PanelApiError(updateResp.error.message, 500)
      }

      return NextResponse.json({ message: 'Codigo de 4 digitos actualizado.' })
    }

    throw new PanelApiError('Accion no soportada.', 400)
  } catch (error) {
    const status = error instanceof PanelApiError ? error.status : 500
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'No se pudo actualizar la configuracion.',
      },
      { status }
    )
  }
}
