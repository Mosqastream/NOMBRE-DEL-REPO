import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  PanelAccount,
  PanelBootstrapPayload,
  PanelOwnerUser,
  PanelProduct,
  PanelProfile,
  PanelSale,
  PanelSupportHistory,
  PanelSupportMessage,
  PanelSupportRequest,
  PanelRole,
} from '@/lib/panel-types'

type ProfileMiniRow = {
  id: string
  username: string
  role: PanelRole
  phone: string | null
  telegram: string | null
  created_at: string
}

type AccountRow = {
  id: string
  owner_id: string
  assigned_user_id: string
  service_name: string
  account_email: string
  account_type: string
  cutoff_date: string | null
  renewal_price: number | string
  renewal_period_days: number
  status: PanelAccount['status']
  created_at: string
  updated_at: string
}

type RequestRow = {
  id: string
  account_id: string | null
  requester_id: string
  owner_id: string
  request_kind: PanelSupportRequest['requestKind']
  status: PanelSupportRequest['status']
  subject: string
  description: string | null
  payment_proof_data_url: string | null
  renewal_price: number | string | null
  created_at: string
  updated_at: string
}

type MessageRow = {
  id: string
  request_id: string
  sender_id: string
  sender_role: PanelRole
  body: string
  image_data_url: string | null
  created_at: string
}

type ProductRow = {
  id: string
  owner_id: string
  provider_name: string
  title: string
  price: number | string
  image_data_url: string | null
  in_stock: boolean
  created_at: string
  updated_at: string
}

type ProductSpecialPriceRow = {
  product_id: string
  user_id: string
  special_price: number | string
  created_at: string
}

type SaleRow = {
  id: string
  product_id: string | null
  buyer_id: string
  owner_id: string
  title_snapshot: string
  provider_name_snapshot: string
  price_paid: number | string
  status: PanelSale['status']
  payment_proof_data_url: string | null
  created_at: string
  updated_at: string
}

type SupportHistoryRow = {
  id: string
  account_email: string | null
  service_name: string | null
  requester_id: string
  owner_id: string
  request_kind: PanelSupportRequest['requestKind']
  subject: string
  description: string | null
  summary: string
  message_count: number
  last_message_preview: string | null
  closed_by_id: string | null
  created_at: string
  closed_at: string
}

const toNumber = (value: string | number | null | undefined) => {
  if (typeof value === 'number') return value
  const parsed = Number(value || 0)
  return Number.isFinite(parsed) ? parsed : 0
}

function uniqueById<T extends { id: string }>(items: T[]) {
  const seen = new Set<string>()
  return items.filter(item => {
    if (seen.has(item.id)) return false
    seen.add(item.id)
    return true
  })
}

const getDaysRemaining = (cutoffDate: string | null) => {
  if (!cutoffDate) return null
  const startOfToday = new Date()
  startOfToday.setHours(0, 0, 0, 0)
  const cutoff = new Date(`${cutoffDate}T00:00:00`)
  if (Number.isNaN(cutoff.getTime())) return null
  return Math.ceil((cutoff.getTime() - startOfToday.getTime()) / 86400000)
}

function mapAccount(row: AccountRow, profilesById: Map<string, ProfileMiniRow>): PanelAccount {
  const ownerProfile = profilesById.get(row.owner_id)

  return {
    id: row.id,
    serviceName: row.service_name,
    accountEmail: row.account_email,
    accountType: row.account_type,
    ownerId: row.owner_id,
    ownerUsername: ownerProfile?.username || 'owner',
    assignedUserId: row.assigned_user_id,
    cutoffDate: row.cutoff_date,
    renewalPrice: toNumber(row.renewal_price),
    renewalPeriodDays: row.renewal_period_days,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    daysRemaining: getDaysRemaining(row.cutoff_date),
  }
}

function mapMessage(row: MessageRow, profilesById: Map<string, ProfileMiniRow>): PanelSupportMessage {
  return {
    id: row.id,
    requestId: row.request_id,
    senderId: row.sender_id,
    senderUsername: profilesById.get(row.sender_id)?.username || 'usuario',
    senderRole: row.sender_role === 'owner' ? 'owner' : 'usuario',
    body: row.body,
    imageDataUrl: row.image_data_url,
    createdAt: row.created_at,
  }
}

function mapRequest(params: {
  row: RequestRow
  profilesById: Map<string, ProfileMiniRow>
  accountsById: Map<string, PanelAccount>
  messagesByRequestId: Map<string, PanelSupportMessage[]>
}): PanelSupportRequest {
  const requester = params.profilesById.get(params.row.requester_id)
  const owner = params.profilesById.get(params.row.owner_id)
  const account = params.row.account_id ? params.accountsById.get(params.row.account_id) : null

  return {
    id: params.row.id,
    accountId: params.row.account_id,
    accountEmail: account?.accountEmail || null,
    serviceName: account?.serviceName || null,
    requesterId: params.row.requester_id,
    requesterUsername: requester?.username || 'usuario',
    ownerId: params.row.owner_id,
    ownerUsername: owner?.username || 'owner',
    requestKind: params.row.request_kind,
    status: params.row.status,
    subject: params.row.subject,
    description: params.row.description,
    paymentProofDataUrl: params.row.payment_proof_data_url,
    renewalPrice: params.row.renewal_price === null ? null : toNumber(params.row.renewal_price),
    createdAt: params.row.created_at,
    updatedAt: params.row.updated_at,
    messages: params.messagesByRequestId.get(params.row.id) || [],
  }
}

function mapProduct(params: {
  row: ProductRow
  profilesById: Map<string, ProfileMiniRow>
  currentUserId: string
  specialPriceMap: Map<string, ProductSpecialPriceRow[]>
}): PanelProduct {
  const ownerProfile = params.profilesById.get(params.row.owner_id)
  const specialRows = params.specialPriceMap.get(params.row.id) || []
  const userSpecial = specialRows.find(item => item.user_id === params.currentUserId)

  return {
    id: params.row.id,
    ownerId: params.row.owner_id,
    ownerUsername: ownerProfile?.username || 'owner',
    providerName: params.row.provider_name,
    title: params.row.title,
    price: toNumber(params.row.price),
    imageDataUrl: params.row.image_data_url,
    inStock: Boolean(params.row.in_stock),
    effectivePrice: userSpecial ? toNumber(userSpecial.special_price) : toNumber(params.row.price),
    createdAt: params.row.created_at,
    updatedAt: params.row.updated_at,
    specialPrices: specialRows.map(item => ({
      userId: item.user_id,
      username: params.profilesById.get(item.user_id)?.username || 'usuario',
      specialPrice: toNumber(item.special_price),
    })),
  }
}

function mapSale(row: SaleRow, profilesById: Map<string, ProfileMiniRow>): PanelSale {
  return {
    id: row.id,
    productId: row.product_id,
    buyerId: row.buyer_id,
    buyerUsername: profilesById.get(row.buyer_id)?.username || 'usuario',
    ownerId: row.owner_id,
    ownerUsername: profilesById.get(row.owner_id)?.username || 'owner',
    titleSnapshot: row.title_snapshot,
    providerNameSnapshot: row.provider_name_snapshot,
    pricePaid: toNumber(row.price_paid),
    status: row.status,
    paymentProofDataUrl: row.payment_proof_data_url,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function mapHistory(row: SupportHistoryRow, profilesById: Map<string, ProfileMiniRow>): PanelSupportHistory {
  return {
    id: row.id,
    accountEmail: row.account_email,
    serviceName: row.service_name,
    requesterId: row.requester_id,
    requesterUsername: profilesById.get(row.requester_id)?.username || 'usuario',
    ownerId: row.owner_id,
    ownerUsername: profilesById.get(row.owner_id)?.username || 'owner',
    requestKind: row.request_kind,
    subject: row.subject,
    description: row.description,
    summary: row.summary,
    messageCount: row.message_count,
    lastMessagePreview: row.last_message_preview,
    closedById: row.closed_by_id,
    closedByUsername: row.closed_by_id ? profilesById.get(row.closed_by_id)?.username || null : null,
    createdAt: row.created_at,
    closedAt: row.closed_at,
  }
}

export async function fetchPanelBootstrap(
  supabaseAdmin: SupabaseClient,
  profile: PanelProfile
): Promise<PanelBootstrapPayload> {
  const profilesResp = await supabaseAdmin
    .from('profiles')
    .select('id, username, role, phone, telegram, created_at')
    .order('username', { ascending: true })

  if (profilesResp.error) {
    throw new Error(profilesResp.error.message)
  }

  const profiles = (profilesResp.data || []) as ProfileMiniRow[]
  const profilesById = new Map(profiles.map(item => [item.id, item]))

  const [accountsResp, requestsResp, messagesResp, productsResp, specialPricesResp, salesResp, historyResp] =
    await Promise.all([
    supabaseAdmin
      .from('service_accounts')
      .select(
        'id, owner_id, assigned_user_id, service_name, account_email, account_type, cutoff_date, renewal_price, renewal_period_days, status, created_at, updated_at'
      )
      .order('created_at', { ascending: false }),
    supabaseAdmin
      .from('support_requests')
      .select(
        'id, account_id, requester_id, owner_id, request_kind, status, subject, description, payment_proof_data_url, renewal_price, created_at, updated_at'
      )
      .order('created_at', { ascending: false }),
    supabaseAdmin
      .from('support_messages')
      .select('id, request_id, sender_id, sender_role, body, image_data_url, created_at')
      .order('created_at', { ascending: true }),
    supabaseAdmin
      .from('panel_products')
      .select('id, owner_id, provider_name, title, price, image_data_url, in_stock, created_at, updated_at')
      .order('created_at', { ascending: false }),
    supabaseAdmin
      .from('panel_product_special_prices')
      .select('product_id, user_id, special_price, created_at')
      .order('created_at', { ascending: false }),
    supabaseAdmin
      .from('panel_sales')
      .select(
        'id, product_id, buyer_id, owner_id, title_snapshot, provider_name_snapshot, price_paid, status, payment_proof_data_url, created_at, updated_at'
      )
      .order('created_at', { ascending: false }),
    supabaseAdmin
      .from('support_request_history')
      .select(
        'id, account_email, service_name, requester_id, owner_id, request_kind, subject, description, summary, message_count, last_message_preview, closed_by_id, created_at, closed_at'
      )
      .order('closed_at', { ascending: false }),
    ])

  for (const response of [accountsResp, requestsResp, messagesResp, productsResp, specialPricesResp, salesResp, historyResp]) {
    if (response.error) {
      throw new Error(response.error.message)
    }
  }

  const accounts = uniqueById(
    ((accountsResp.data || []) as AccountRow[]).map(row => mapAccount(row, profilesById))
  )
  const accountsById = new Map(accounts.map(item => [item.id, item]))

  const messagesByRequestId = new Map<string, PanelSupportMessage[]>()
  for (const row of (messagesResp.data || []) as MessageRow[]) {
    const mapped = mapMessage(row, profilesById)
    const current = messagesByRequestId.get(mapped.requestId) || []
    current.push(mapped)
    messagesByRequestId.set(mapped.requestId, current)
  }

  const supportRequests = uniqueById(
    ((requestsResp.data || []) as RequestRow[]).map(row =>
      mapRequest({
        row,
        profilesById,
        accountsById,
        messagesByRequestId,
      })
    )
  )

  const specialPriceMap = new Map<string, ProductSpecialPriceRow[]>()
  for (const row of (specialPricesResp.data || []) as ProductSpecialPriceRow[]) {
    const current = specialPriceMap.get(row.product_id) || []
    current.push(row)
    specialPriceMap.set(row.product_id, current)
  }

  const products = uniqueById(
    ((productsResp.data || []) as ProductRow[]).map(row =>
      mapProduct({
        row,
        profilesById,
        currentUserId: profile.id,
        specialPriceMap,
      })
    )
  )

  const sales = uniqueById(((salesResp.data || []) as SaleRow[]).map(row => mapSale(row, profilesById)))
  const supportHistory = uniqueById(
    ((historyResp.data || []) as SupportHistoryRow[]).map(row => mapHistory(row, profilesById))
  )

  const visibleAccounts =
    profile.role === 'owner'
      ? accounts.filter(item => item.ownerId === profile.id || item.assignedUserId === profile.id)
      : accounts.filter(item => item.assignedUserId === profile.id)

  const visibleRequests =
    profile.role === 'owner'
      ? supportRequests.filter(item => item.ownerId === profile.id || item.requesterId === profile.id)
      : supportRequests.filter(item => item.requesterId === profile.id)

  const visibleProducts =
    profile.role === 'owner'
      ? products.filter(item => item.ownerId === profile.id || item.inStock)
      : products.filter(item => item.inStock)

  const visibleSales =
    profile.role === 'owner'
      ? sales.filter(item => item.ownerId === profile.id || item.buyerId === profile.id)
      : sales.filter(item => item.buyerId === profile.id)

  const visibleHistory =
    profile.role === 'owner'
      ? supportHistory.filter(item => item.ownerId === profile.id || item.requesterId === profile.id)
      : supportHistory.filter(item => item.requesterId === profile.id)

  const allUsers: PanelOwnerUser[] =
    profile.role === 'owner'
      ? profiles.map(item => {
          const userAccounts = accounts.filter(
            account => account.assignedUserId === item.id && account.ownerId === profile.id
          )
          return {
            id: item.id,
            username: item.username,
            role: item.role === 'owner' ? 'owner' : 'usuario',
            telegram: item.telegram,
            phone: item.phone,
            createdAt: item.created_at,
            activeAccounts: userAccounts.filter(account => account.status === 'activa').length,
            accounts: userAccounts,
          }
        })
      : []

  return {
    profile,
    accounts: visibleAccounts,
    supportRequests: visibleRequests,
    supportHistory: visibleHistory,
    products: visibleProducts,
    sales: visibleSales,
    allUsers,
  }
}
