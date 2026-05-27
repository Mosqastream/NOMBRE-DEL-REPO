import { NextRequest, NextResponse } from 'next/server'
import { PanelApiError, requirePanelSession } from '@/lib/panel-auth'
import { fetchPanelBootstrap } from '@/lib/panel-data'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const session = await requirePanelSession(request)
    const payload = await fetchPanelBootstrap(session.supabaseAdmin, session.profile)
    return NextResponse.json(payload)
  } catch (error) {
    const status = error instanceof PanelApiError ? error.status : 500
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'No se pudo cargar el panel.',
      },
      { status }
    )
  }
}
