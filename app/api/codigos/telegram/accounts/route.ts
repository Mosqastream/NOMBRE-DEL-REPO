import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabaseAdmin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type AccountRow = {
  account_email: string | null
}

type TelegramAccountRow = {
  account_email: string | null
}

const normalizeEmail = (value: unknown) => String(value || '').trim().toLowerCase()

export async function GET(request: NextRequest) {
  try {
    const supabaseAdmin = getSupabaseAdmin()
    const authHeader = request.headers.get('authorization') || ''
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : ''

    if (!token) {
      return NextResponse.json({ recipients: [] })
    }

    const userResp = await supabaseAdmin.auth.getUser(token)
    if (userResp.error || !userResp.data.user) {
      return NextResponse.json({ recipients: [] })
    }

    const accountsResp = await supabaseAdmin
      .from('service_accounts')
      .select('account_email')
      .eq('assigned_user_id', userResp.data.user.id)
      .order('created_at', { ascending: false })
      .limit(1000)

    if (accountsResp.error) {
      throw new Error(accountsResp.error.message)
    }

    const assignedEmails = Array.from(
      new Set(((accountsResp.data || []) as AccountRow[]).map(row => normalizeEmail(row.account_email)).filter(Boolean))
    )

    if (assignedEmails.length === 0) {
      return NextResponse.json({ recipients: [] })
    }

    const telegramResp = await supabaseAdmin
      .from('telegram_code_accounts')
      .select('account_email')
      .eq('enabled', true)
      .in('account_email', assignedEmails)

    if (telegramResp.error) {
      throw new Error(telegramResp.error.message)
    }

    const recipients = Array.from(
      new Set(
        ((telegramResp.data || []) as TelegramAccountRow[])
          .map(row => normalizeEmail(row.account_email))
          .filter(Boolean)
      )
    )

    return NextResponse.json({ recipients })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'No se pudieron cargar cuentas Telegram.' },
      { status: 500 }
    )
  }
}
