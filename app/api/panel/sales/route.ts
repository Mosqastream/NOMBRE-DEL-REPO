import { NextRequest, NextResponse } from 'next/server'
import { PanelApiError, requirePanelSession } from '@/lib/panel-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    const session = await requirePanelSession(request, true)
    const body = (await request.json().catch(() => ({}))) as {
      saleId?: string
      status?: string
    }

    const saleId = String(body.saleId || '').trim()
    const status = String(body.status || '').trim()

    if (!saleId) {
      throw new PanelApiError('Venta no valida.', 400)
    }

    if (!new Set(['pendiente', 'pagada', 'cancelada']).has(status)) {
      throw new PanelApiError('Estado no valido.', 400)
    }

    const updateResp = await session.supabaseAdmin
      .from('panel_sales')
      .update({ status } as never)
      .eq('id', saleId)
      .eq('owner_id', session.profile.id)

    if (updateResp.error) {
      throw new PanelApiError(updateResp.error.message, 500)
    }

    return NextResponse.json({ message: 'Venta actualizada.' })
  } catch (error) {
    const status = error instanceof PanelApiError ? error.status : 500
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'No se pudo actualizar la venta.',
      },
      { status }
    )
  }
}
