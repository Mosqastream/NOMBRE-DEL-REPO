import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getSupabaseAdmin } from '@/lib/supabaseAdmin'
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

type LoginProfileRow = {
  security_pin_hash: string
  username: string
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      password?: string
      phoneCountry?: string
      phoneDigits?: string
      securityPin?: string
      username?: string
    }

    const username = normalizeUsername(body.username || '')
    const phoneCountry = normalizePhoneCountry(body.phoneCountry || '')
    const phoneDigits = normalizePhoneDigits(body.phoneDigits || '')
    const securityPin = normalizeSecurityPin(body.securityPin || '')
    const password = body.password || ''

    const validationError =
      validateUsername(username) ||
      validatePhone(phoneCountry, phoneDigits) ||
      validatePassword(password) ||
      validateSecurityPin(securityPin)

    if (validationError) {
      return NextResponse.json({ error: validationError }, { status: 400 })
    }

    const phone = buildPhoneNumber(phoneCountry, phoneDigits)
    const supabaseAdmin = getSupabaseAdmin()

    const profileResp = await supabaseAdmin
      .from('profiles')
      .select('username, security_pin_hash')
      .eq('username', username)
      .eq('phone', phone)
      .limit(1)

    if (profileResp.error) {
      return NextResponse.json({ error: profileResp.error.message }, { status: 500 })
    }

    const profile = ((profileResp.data || [])[0] || null) as LoginProfileRow | null
    if (!profile?.username) {
      return NextResponse.json({ error: 'Datos de acceso inválidos.' }, { status: 401 })
    }

    if (profile.security_pin_hash !== hashSecurityPin(securityPin)) {
      return NextResponse.json({ error: 'Código de seguridad inválido.' }, { status: 401 })
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

    if (!supabaseUrl || !supabaseAnonKey) {
      return NextResponse.json({ error: 'Supabase no está configurado.' }, { status: 500 })
    }

    const publicClient = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    })

    const signInResp = await publicClient.auth.signInWithPassword({
      email: usernameToAuthEmail(profile.username),
      password,
    })

    if (signInResp.error || !signInResp.data.session) {
      return NextResponse.json({ error: 'Datos de acceso inválidos.' }, { status: 401 })
    }

    return NextResponse.json({
      session: {
        access_token: signInResp.data.session.access_token,
        refresh_token: signInResp.data.session.refresh_token,
      },
    })
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'No se pudo iniciar sesión.',
      },
      { status: 500 }
    )
  }
}
