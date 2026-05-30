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
  parent_id?: string | null
  created_by_id?: string | null
  onboarding_status?: 'active' | 'pending' | null
  created_at: string
}

type AccountRow = {
  id: string
  owner_id: string
  assigned_user_id: string
  assigned_by_id?: string | null
  parent_account_id?: string | null
  root_account_id?: string | null
  assignment_depth?: number
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

function getDescendantProfileIds(profiles: ProfileMiniRow[], rootProfileId: string) {
  const descendants = new Set<string>()
  let changed = true

  while (changed) {
    changed = false

    for (const profile of profiles) {
      if (descendants.has(profile.id)) continue
      const parentId = profile.parent_id || profile.created_by_id || null

      if (parentId === rootProfileId || (parentId && descendants.has(parentId))) {
        descendants.add(profile.id)
        changed = true
      }
    }
  }

  return [...descendants]
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
    assignedById: row.assigned_by_id || null,
    parentAccountId: row.parent_account_id || null,
    rootAccountId: row.root_account_id || row.id,
    assignmentDepth: Number(row.assignment_depth || 0),
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
  const senderRole = row.sender_role === 'owner' ? 'owner' : 'usuario'
  return {
    id: row.id,
    requestId: row.request_id,
    senderId: row.sender_id,
    senderUsername: senderRole === 'owner' ? 'Sistema' : profilesById.get(row.sender_id)?.username || 'usuario',
    senderRole,
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
    .select('id, username, role, phone, telegram, parent_id, created_by_id, onboarding_status, created_at')
    .order('created_at', { ascending: false })
    .range(0, 9999)

  if (profilesResp.error) {
    throw new Error(profilesResp.error.message)
  }

  const profiles = (profilesResp.data || []) as ProfileMiniRow[]
  const profilesById = new Map(profiles.map(item => [item.id, item]))
  const descendantProfileIds = getDescendantProfileIds(profiles, profile.id)
  const visibleProfileIds = [profile.id, ...descendantProfileIds]

  const accountSelect =
    'id, owner_id, assigned_user_id, assigned_by_id, parent_account_id, root_account_id, assignment_depth, service_name, account_email, account_type, cutoff_date, renewal_price, renewal_period_days, status, created_at, updated_at'
  const requestSelect =
    'id, account_id, requester_id, owner_id, request_kind, status, subject, description, payment_proof_data_url, renewal_price, created_at, updated_at'
  const saleSelect =
    'id, product_id, buyer_id, owner_id, title_snapshot, provider_name_snapshot, price_paid, status, payment_proof_data_url, created_at, updated_at'
  const historySelect =
    'id, account_email, service_name, requester_id, owner_id, request_kind, subject, description, summary, message_count, last_message_preview, closed_by_id, created_at, closed_at'

  const accountsQuery = supabaseAdmin
    .from('service_accounts')
    .select(accountSelect)
    .order('created_at', { ascending: false })

  const requestsQuery = supabaseAdmin
    .from('support_requests')
    .select(requestSelect)
    .order('created_at', { ascending: false })

  const productsQuery = supabaseAdmin
    .from('panel_products')
    .select('id, owner_id, provider_name, title, price, image_data_url, in_stock, created_at, updated_at')
    .order('created_at', { ascending: false })

  const salesQuery = supabaseAdmin
    .from('panel_sales')
    .select(saleSelect)
    .order('created_at', { ascending: false })

  const historyQuery = supabaseAdmin
    .from('support_request_history')
    .select(historySelect)
    .order('closed_at', { ascending: false })

  const visibleAccountsQuery =
    profile.role === 'owner'
      ? accountsQuery.or(`owner_id.eq.${profile.id},assigned_user_id.eq.${profile.id}`)
      : accountsQuery.in('assigned_user_id', visibleProfileIds)

  const visibleRequestsQuery =
    profile.role === 'owner'
      ? requestsQuery.or(`owner_id.eq.${profile.id},requester_id.eq.${profile.id}`)
      : requestsQuery.in('requester_id', visibleProfileIds)

  const visibleProductsQuery =
    profile.role === 'owner'
      ? productsQuery.or(`owner_id.eq.${profile.id},in_stock.eq.true`)
      : profile.parentId
        ? productsQuery.eq('owner_id', '00000000-0000-0000-0000-000000000000')
        : productsQuery.eq('in_stock', true)

  const visibleSalesQuery =
    profile.role === 'owner'
      ? salesQuery.or(`owner_id.eq.${profile.id},buyer_id.eq.${profile.id}`)
      : salesQuery.eq('buyer_id', profile.id)

  const visibleHistoryQuery =
    profile.role === 'owner'
      ? historyQuery
      : historyQuery.in('requester_id', visibleProfileIds)

  const [accountsResp, requestsResp, productsResp, specialPricesResp, salesResp, historyResp] =
    await Promise.all([
      visibleAccountsQuery,
      visibleRequestsQuery,
      visibleProductsQuery,
      supabaseAdmin
        .from('panel_product_special_prices')
        .select('product_id, user_id, special_price, created_at')
        .order('created_at', { ascending: false }),
      visibleSalesQuery,
      visibleHistoryQuery,
    ])

  for (const response of [accountsResp, requestsResp, productsResp, specialPricesResp, salesResp, historyResp]) {
    if (response.error) {
      throw new Error(response.error.message)
    }
  }

  const accounts = uniqueById(
    ((accountsResp.data || []) as AccountRow[]).map(row => mapAccount(row, profilesById))
  )
  const accountsById = new Map(accounts.map(item => [item.id, item]))

  const requestRows = (requestsResp.data || []) as RequestRow[]
  const requestIds = requestRows.map(row => row.id)
  const messagesResp =
    requestIds.length > 0
      ? await supabaseAdmin
          .from('support_messages')
          .select('id, request_id, sender_id, sender_role, body, image_data_url, created_at')
          .in('request_id', requestIds)
          .order('created_at', { ascending: true })
      : { data: [], error: null }

  if (messagesResp.error) {
    throw new Error(messagesResp.error.message)
  }

  const messagesByRequestId = new Map<string, PanelSupportMessage[]>()
  for (const row of (messagesResp.data || []) as MessageRow[]) {
    const mapped = mapMessage(row, profilesById)
    const current = messagesByRequestId.get(mapped.requestId) || []
    current.push(mapped)
    messagesByRequestId.set(mapped.requestId, current)
  }

  const supportRequests = uniqueById(
    requestRows.map(row =>
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
            parentId: item.parent_id || null,
            createdById: item.created_by_id || null,
            onboardingStatus: item.onboarding_status === 'pending' ? 'pending' : 'active',
            createdAt: item.created_at,
            activeAccounts: userAccounts.filter(account => account.status === 'activa').length,
            accounts: userAccounts,
          }
        })
      : profiles
          .filter(item => descendantProfileIds.includes(item.id))
          .map(item => {
            const userAccounts = accounts.filter(account => account.assignedUserId === item.id)
            return {
              id: item.id,
              username: item.username,
              role: item.role === 'owner' ? 'owner' : 'usuario',
              telegram: item.telegram,
              phone: item.phone,
              parentId: item.parent_id || null,
              createdById: item.created_by_id || null,
              onboardingStatus: item.onboarding_status === 'pending' ? 'pending' : 'active',
              createdAt: item.created_at,
              activeAccounts: userAccounts.filter(account => account.status === 'activa').length,
              accounts: userAccounts,
            }
          })

  return {
    profile,
    accounts,
    supportRequests,
    supportHistory,
    products,
    sales,
    allUsers,
  }
}
