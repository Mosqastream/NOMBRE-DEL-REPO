import { NextRequest, NextResponse } from 'next/server'
import { PanelApiError, requirePanelSession } from '@/lib/panel-auth'
import { normalizeDataUrlImage, parseMoney } from '@/lib/panel-utils'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type SpecialPriceInput = {
  userId?: string
  specialPrice?: number
}

type ProductRow = {
  id: string
  owner_id: string
  provider_name: string
  title: string
  price: number | string
  image_data_url?: string | null
  in_stock: boolean
  created_at?: string
  updated_at?: string
}

type SpecialPriceRow = {
  user_id?: string
  special_price: number | string
}

type ProfileMiniRow = {
  id: string
  username: string
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      action?: string
      productId?: string
      title?: string
      providerName?: string
      price?: number
      imageDataUrl?: string
      inStock?: boolean
      specialPrices?: SpecialPriceInput[]
      paymentProofDataUrl?: string
    }

    const action = String(body.action || '').trim()

    if (action === 'create') {
      const session = await requirePanelSession(request, true)
      const title = String(body.title || '').trim()
      const providerName = String(body.providerName || session.profile.username).trim() || session.profile.username
      const price = parseMoney(body.price, 0)
      const imageDataUrl = normalizeDataUrlImage(body.imageDataUrl)
      const inStock = Boolean(body.inStock ?? true)
      const specialPrices = Array.isArray(body.specialPrices) ? body.specialPrices : []

      if (!title) {
        throw new PanelApiError('Ingresa el titulo del producto.', 400)
      }

      const productResp = await session.supabaseAdmin
        .from('panel_products')
        .insert({
          owner_id: session.profile.id,
          provider_name: providerName,
          title,
          price,
          image_data_url: imageDataUrl,
          in_stock: inStock,
        } as never)
        .select('id, owner_id, provider_name, title, price, image_data_url, in_stock, created_at, updated_at')
        .maybeSingle()

      const insertedProduct = (productResp.data || null) as ProductRow | null

      if (productResp.error || !insertedProduct?.id) {
        throw new PanelApiError(productResp.error?.message || 'No se pudo crear el producto.', 500)
      }

      const validSpecialPrices = specialPrices
        .map(item => ({
          product_id: insertedProduct.id,
          user_id: String(item.userId || '').trim(),
          special_price: parseMoney(item.specialPrice, 0),
        }))
        .filter(item => item.user_id)

      if (validSpecialPrices.length > 0) {
        const specialResp = await session.supabaseAdmin
          .from('panel_product_special_prices')
          .insert(validSpecialPrices as never)

        if (specialResp.error) {
          throw new PanelApiError(specialResp.error.message, 500)
        }
      }

      const userIds = validSpecialPrices.map(item => item.user_id)
      let usernamesById = new Map<string, string>()

      if (userIds.length > 0) {
        const profilesResp = await session.supabaseAdmin
          .from('profiles')
          .select('id, username')
          .in('id', userIds)

        if (profilesResp.error) {
          throw new PanelApiError(profilesResp.error.message, 500)
        }

        usernamesById = new Map(
          ((profilesResp.data || []) as ProfileMiniRow[]).map(item => [item.id, item.username])
        )
      }

      return NextResponse.json({
        message: 'Producto creado.',
        product: {
          id: insertedProduct.id,
          ownerId: insertedProduct.owner_id,
          ownerUsername: session.profile.username,
          providerName: insertedProduct.provider_name,
          title: insertedProduct.title,
          price: parseMoney(insertedProduct.price, 0),
          imageDataUrl: insertedProduct.image_data_url,
          inStock: Boolean(insertedProduct.in_stock),
          effectivePrice: parseMoney(insertedProduct.price, 0),
          createdAt: insertedProduct.created_at,
          updatedAt: insertedProduct.updated_at,
          specialPrices: validSpecialPrices.map(item => ({
            userId: item.user_id,
            username: usernamesById.get(item.user_id) || 'usuario',
            specialPrice: parseMoney(item.special_price, 0),
          })),
        },
      })
    }

    if (action === 'toggle_stock') {
      const session = await requirePanelSession(request, true)
      const productId = String(body.productId || '').trim()

      if (!productId) {
        throw new PanelApiError('Producto no valido.', 400)
      }

      const productResp = await session.supabaseAdmin
        .from('panel_products')
        .select('id, owner_id, in_stock')
        .eq('id', productId)
        .eq('owner_id', session.profile.id)
        .maybeSingle()

      const stockProduct = (productResp.data || null) as { id: string; in_stock: boolean } | null

      if (productResp.error || !stockProduct?.id) {
        throw new PanelApiError(productResp.error?.message || 'Producto no encontrado.', 404)
      }

      const updateResp = await session.supabaseAdmin
        .from('panel_products')
        .update({
          in_stock: !stockProduct.in_stock,
        } as never)
        .eq('id', productId)

      if (updateResp.error) {
        throw new PanelApiError(updateResp.error.message, 500)
      }

      return NextResponse.json({ message: 'Stock actualizado.' })
    }

    if (action === 'delete') {
      const session = await requirePanelSession(request, true)
      const productId = String(body.productId || '').trim()

      if (!productId) {
        throw new PanelApiError('Producto no valido.', 400)
      }

      const deleteResp = await session.supabaseAdmin
        .from('panel_products')
        .delete()
        .eq('id', productId)
        .eq('owner_id', session.profile.id)

      if (deleteResp.error) {
        throw new PanelApiError(deleteResp.error.message, 500)
      }

      return NextResponse.json({ message: 'Producto eliminado.' })
    }

    if (action === 'purchase') {
      const session = await requirePanelSession(request)
      const productId = String(body.productId || '').trim()
      const paymentProofDataUrl = normalizeDataUrlImage(body.paymentProofDataUrl)

      if (!productId) {
        throw new PanelApiError('Producto no valido.', 400)
      }

      const productResp = await session.supabaseAdmin
        .from('panel_products')
        .select('id, owner_id, provider_name, title, price, in_stock')
        .eq('id', productId)
        .maybeSingle()

      const purchasableProduct = (productResp.data || null) as ProductRow | null

      if (productResp.error || !purchasableProduct?.id) {
        throw new PanelApiError(productResp.error?.message || 'Producto no encontrado.', 404)
      }

      const product = purchasableProduct
      if (!product.in_stock) {
        throw new PanelApiError('Este producto esta sin stock.', 400)
      }

      const specialPriceResp = await session.supabaseAdmin
        .from('panel_product_special_prices')
        .select('special_price')
        .eq('product_id', product.id)
        .eq('user_id', session.profile.id)
        .maybeSingle()

      if (specialPriceResp.error) {
        throw new PanelApiError(specialPriceResp.error.message, 500)
      }

      const specialPrice = (specialPriceResp.data as SpecialPriceRow | null)?.special_price
      const pricePaid = parseMoney(specialPrice ?? product.price, 0)

      const saleResp = await session.supabaseAdmin.from('panel_sales').insert({
        product_id: product.id,
        buyer_id: session.profile.id,
        owner_id: product.owner_id,
        title_snapshot: product.title,
        provider_name_snapshot: product.provider_name,
        price_paid: pricePaid,
        status: 'pendiente',
        payment_proof_data_url: paymentProofDataUrl,
      } as never)

      if (saleResp.error) {
        throw new PanelApiError(saleResp.error.message, 500)
      }

      return NextResponse.json({ message: 'Compra enviada al proveedor.' })
    }

    throw new PanelApiError('Accion no soportada.', 400)
  } catch (error) {
    const status = error instanceof PanelApiError ? error.status : 500
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'No se pudo completar la operacion.',
      },
      { status }
    )
  }
}
