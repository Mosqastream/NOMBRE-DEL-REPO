export type PanelRole = 'usuario' | 'owner'
export type PanelView = 'usuario' | 'owner'

export type UserSectionId =
  | 'cuentas'
  | 'soporte'
  | 'gestion'
  | 'compras'
  | 'codigos'
  | 'historial'
  | 'configuracion'
export type OwnerSectionId = 'vip' | 'solicitudes' | 'asignacion' | 'ventas' | 'historial'
export type PanelSectionId = UserSectionId | OwnerSectionId

export type ServiceAccountStatus = 'activa' | 'pausada' | 'sin_pago' | 'desactivada'
export type SupportRequestKind = 'no_payment' | 'issue' | 'renewal'
export type SupportRequestStatus =
  | 'abierta'
  | 'en_chat'
  | 'pendiente_revision'
  | 'aprobada'
  | 'rechazada'
  | 'cierre_solicitado'
  | 'cerrada'
export type SaleStatus = 'pendiente' | 'pagada' | 'cancelada'

export type PanelProfile = {
  id: string
  username: string
  role: PanelRole
  phone: string | null
  telegram: string | null
  createdAt: string
}

export type PanelAccount = {
  id: string
  serviceName: string
  accountEmail: string
  accountType: string
  ownerId: string
  ownerUsername: string
  assignedUserId: string
  cutoffDate: string | null
  renewalPrice: number
  renewalPeriodDays: number
  status: ServiceAccountStatus
  createdAt: string
  updatedAt: string
  daysRemaining: number | null
}

export type PanelSupportMessage = {
  id: string
  requestId: string
  senderId: string
  senderUsername: string
  senderRole: PanelRole
  body: string
  imageDataUrl: string | null
  createdAt: string
}

export type PanelSupportRequest = {
  id: string
  accountId: string | null
  accountEmail: string | null
  serviceName: string | null
  requesterId: string
  requesterUsername: string
  ownerId: string
  ownerUsername: string
  requestKind: SupportRequestKind
  status: SupportRequestStatus
  subject: string
  description: string | null
  paymentProofDataUrl: string | null
  renewalPrice: number | null
  createdAt: string
  updatedAt: string
  messages: PanelSupportMessage[]
}

export type PanelSupportHistory = {
  id: string
  accountEmail: string | null
  serviceName: string | null
  requesterId: string
  requesterUsername: string
  ownerId: string
  ownerUsername: string
  requestKind: SupportRequestKind
  subject: string
  description: string | null
  summary: string
  messageCount: number
  lastMessagePreview: string | null
  closedById: string | null
  closedByUsername: string | null
  closedAt: string
  createdAt: string
}

export type PanelProductSpecialPrice = {
  userId: string
  username: string
  specialPrice: number
}

export type PanelProduct = {
  id: string
  ownerId: string
  ownerUsername: string
  providerName: string
  title: string
  price: number
  imageDataUrl: string | null
  inStock: boolean
  effectivePrice: number
  createdAt: string
  updatedAt: string
  specialPrices: PanelProductSpecialPrice[]
}

export type PanelSale = {
  id: string
  productId: string | null
  buyerId: string
  buyerUsername: string
  ownerId: string
  ownerUsername: string
  titleSnapshot: string
  providerNameSnapshot: string
  pricePaid: number
  status: SaleStatus
  paymentProofDataUrl: string | null
  createdAt: string
  updatedAt: string
}

export type PanelOwnerUser = {
  id: string
  username: string
  role: PanelRole
  telegram: string | null
  phone: string | null
  createdAt: string
  activeAccounts: number
  accounts: PanelAccount[]
}

export type PanelBootstrapPayload = {
  profile: PanelProfile
  accounts: PanelAccount[]
  supportRequests: PanelSupportRequest[]
  supportHistory: PanelSupportHistory[]
  products: PanelProduct[]
  sales: PanelSale[]
  allUsers: PanelOwnerUser[]
}
