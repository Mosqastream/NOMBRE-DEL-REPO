import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabaseAdmin'
import {
  buildPhoneNumber,
  normalizePhoneCountry,
  normalizePhoneDigits,
  normalizeTelegram,
  normalizeUsername,
  usernameToAuthEmail,
  validatePassword,
  validatePhone,
  validateTelegram,
  validateUsername,
} from '@/lib/auth-identity'
import { hashSecurityPin, normalizeSecurityPin, validateSecurityPin } from '@/lib/security-pin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      password?: string
      phoneCountry?: string
      phoneDigits?: string
      securityPin?: string
      telegram?: string
      username?: string
    }

    const username = normalizeUsername(body.username || '')
    const password = body.password || ''
    const phoneCountry = normalizePhoneCountry(body.phoneCountry || '')
    const phoneDigits = normalizePhoneDigits(body.phoneDigits || '')
    const phone = buildPhoneNumber(phoneCountry, phoneDigits)
    const securityPin = normalizeSecurityPin(body.securityPin || '')
    const telegram = normalizeTelegram(body.telegram || '')

    const validationError =
      validateUsername(username) ||
      validatePassword(password) ||
      validatePhone(phoneCountry, phoneDigits) ||
      validateSecurityPin(securityPin) ||
      validateTelegram(telegram)

    if (validationError) {
      return NextResponse.json({ error: validationError }, { status: 400 })
    }

    const supabaseAdmin = getSupabaseAdmin()
    const email = usernameToAuthEmail(username)

    const existingProfiles = await supabaseAdmin
      .from('profiles')
      .select('id')
      .eq('username', username)
      .limit(1)

    if (!existingProfiles.error && (existingProfiles.data || []).length > 0) {
      return NextResponse.json({ error: 'Ese nombre de usuario ya está registrado.' }, { status: 409 })
    }

    const existingPhone = await supabaseAdmin
      .from('profiles')
      .select('id')
      .eq('phone', phone)
      .limit(1)

    if (!existingPhone.error && (existingPhone.data || []).length > 0) {
      return NextResponse.json({ error: 'Ese número de teléfono ya está registrado.' }, { status: 409 })
    }

    const createdUser = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        username,
        phone,
        security_pin_hash: hashSecurityPin(securityPin),
        telegram: telegram || null,
      },
    })

    if (createdUser.error) {
      const message = createdUser.error.message.toLowerCase()
      if (message.includes('database error creating new user')) {
        return NextResponse.json(
          {
            error:
              'Tu base de datos no esta actualizada. Ejecuta de nuevo el SQL 001_auth_profiles_setup.sql para agregar el PIN de 4 digitos y recrear el trigger.',
          },
          { status: 500 }
        )
      }

      if (message.includes('already been registered') || message.includes('already registered')) {
        return NextResponse.json({ error: 'Ese nombre de usuario ya existe.' }, { status: 409 })
      }

      return NextResponse.json({ error: createdUser.error.message }, { status: 400 })
    }

    return NextResponse.json({
      message: 'Cuenta creada y aprobada al instante.',
      userId: createdUser.data.user?.id || null,
    })
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'No se pudo crear la cuenta.',
      },
      { status: 500 }
    )
  }
}
