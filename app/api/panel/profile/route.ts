import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabaseAdmin'
import { normalizeUsername } from '@/lib/auth-identity'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type ProfileLookupRow = {
  role: 'owner' | 'usuario'
  username: string
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      userId?: string
      username?: string
    }

    const userId = String(body.userId || '').trim()
    const username = normalizeUsername(body.username || '')
    const supabaseAdmin = getSupabaseAdmin()

    let profile: ProfileLookupRow | null = null

    if (userId) {
      const profileByIdResp = await supabaseAdmin
        .from('profiles')
        .select('role, username')
        .eq('id', userId)
        .maybeSingle()

      if (profileByIdResp.error) {
        return NextResponse.json({ error: profileByIdResp.error.message }, { status: 500 })
      }

      const profileById = profileByIdResp.data as ProfileLookupRow | null

      if (profileById?.username) {
        profile = {
          role: profileById.role === 'owner' ? 'owner' : 'usuario',
          username: normalizeUsername(profileById.username),
        }
      }
    }

    if (!profile && username) {
      const profileByUsernameResp = await supabaseAdmin
        .from('profiles')
        .select('role, username')
        .eq('username', username)
        .maybeSingle()

      if (profileByUsernameResp.error) {
        return NextResponse.json({ error: profileByUsernameResp.error.message }, { status: 500 })
      }

      const profileByUsername = profileByUsernameResp.data as ProfileLookupRow | null

      if (profileByUsername?.username) {
        profile = {
          role: profileByUsername.role === 'owner' ? 'owner' : 'usuario',
          username: normalizeUsername(profileByUsername.username),
        }
      }
    }

    return NextResponse.json({
      profile: profile || null,
    })
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'No se pudo resolver el perfil.',
      },
      { status: 500 }
    )
  }
}
