'use client'

import { ChangeEvent, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { CodigosWorkspace } from '@/app/codigos/CodigosWorkspace'
import type {
  OwnerSectionId,
  PanelAccount,
  PanelBootstrapPayload,
  PanelOwnerUser,
  PanelProduct,
  PanelRole,
  PanelSale,
  PanelSectionId,
  PanelSupportHistory,
  PanelSupportRequest,
  PanelView,
  UserSectionId,
} from '@/lib/panel-types'
import { supabase } from '@/lib/supabaseClient'
import styles from './panel.module.css'

const USER_SECTIONS = [
  { id: 'cuentas', label: 'Cuentas', icon: 'wallet' },
  { id: 'soporte', label: 'Soporte', icon: 'chat' },
  { id: 'gestion', label: 'Usuarios', icon: 'users' },
  { id: 'compras', label: 'Compras', icon: 'card' },
  { id: 'codigos', label: 'Codigos', icon: 'shield' },
  { id: 'historial', label: 'Historial', icon: 'clock' },
  { id: 'configuracion', label: 'Configuracion', icon: 'settings' },
] as const

const OWNER_SECTIONS = [
  { id: 'vip', label: 'Usuarios', icon: 'crown' },
  { id: 'solicitudes', label: 'Solicitudes', icon: 'bell' },
  { id: 'asignacion', label: 'Asignacion', icon: 'spark' },
  { id: 'ventas', label: 'Ventas', icon: 'clock' },
  { id: 'telegram', label: 'Telegram', icon: 'send' },
  { id: 'codigos', label: 'Codigos', icon: 'shield' },
  { id: 'historial', label: 'Historial', icon: 'clock' },
  { id: 'configuracion', label: 'Configuracion', icon: 'settings' },
] as const

const PAGE_SIZE = 8

type SectionIconName =
  | (typeof USER_SECTIONS)[number]['icon']
  | (typeof OWNER_SECTIONS)[number]['icon']
  | 'crown'

type SupportIssueForm = {
  subject: string
  description: string
}

type SupportMessageForm = {
  body: string
  imageDataUrl: string | null
}

type AssignForm = {
  serviceName: string
  accountType: string
  cutoffDate: string
  renewalPrice: string
  renewalPeriodDays: string
  emailsText: string
}

type AccountEditForm = {
  id: string
  serviceName: string
  accountEmail: string
  accountType: string
  cutoffDate: string
  renewalPrice: string
  renewalPeriodDays: string
  status: string
}

type ProductSpecialDraft = {
  userId: string
  specialPrice: string
}

type ProductForm = {
  title: string
  providerName: string
  price: string
  inStock: boolean
  imageDataUrl: string | null
  search: string
  pendingUserId: string
  pendingSpecialPrice: string
  specialRows: ProductSpecialDraft[]
}

type SettingsForm = {
  currentPassword: string
  nextPassword: string
  nextPasswordConfirm: string
  currentPin: string
  nextPin: string
  nextPinConfirm: string
}

type TelegramAccount = {
  id: string
  accountEmail: string
  serviceName: string
  enabled: boolean
  createdAt: string
  updatedAt: string
}

type TelegramForm = {
  accountEmail: string
  serviceName: string
}

type PanelApiPayload = {
  error?: string
  message?: string
  requestId?: string | null
  accountId?: string
  accounts?: PanelAccount[]
  product?: PanelProduct
  productId?: string
  saleId?: string
  user?: Pick<PanelOwnerUser, 'id' | 'username'>
  users?: Array<Pick<PanelOwnerUser, 'id' | 'username'>>
  omitted?: Array<{ username?: string; reason: string }>
  excelPreview?: ExcelAssignPreview
}

type ExcelAssignPreview = {
  totalRows: number
  assignments: Array<{
    email: string
    userId: string
    username: string
    cutoffDate: string | null
    serviceName: string
    accountType: string
  }>
  omitted: Array<{
    email: string
    reason: string
  }>
}

type OwnerAccountFilter = 'todos' | 'vigentes' | 'por_vencer' | 'vencidas'
type UserAccountFilter = OwnerAccountFilter | 'soporte'

const defaultIssueForm: SupportIssueForm = {
  subject: '',
  description: '',
}

const defaultMessageForm: SupportMessageForm = {
  body: '',
  imageDataUrl: null,
}

const defaultAssignForm: AssignForm = {
  serviceName: 'Netflix',
  accountType: 'Cuenta completa',
  cutoffDate: '',
  renewalPrice: '',
  renewalPeriodDays: '30',
  emailsText: '',
}

const defaultAccountEditForm: AccountEditForm = {
  id: '',
  serviceName: 'Netflix',
  accountEmail: '',
  accountType: 'Cuenta completa',
  cutoffDate: '',
  renewalPrice: '',
  renewalPeriodDays: '30',
  status: 'activa',
}

const defaultProductForm = (providerName = ''): ProductForm => ({
  title: '',
  providerName,
  price: '',
  inStock: true,
  imageDataUrl: null,
  search: '',
  pendingUserId: '',
  pendingSpecialPrice: '',
  specialRows: [],
})

const defaultSettingsForm: SettingsForm = {
  currentPassword: '',
  nextPassword: '',
  nextPasswordConfirm: '',
  currentPin: '',
  nextPin: '',
  nextPinConfirm: '',
}

const defaultTelegramForm: TelegramForm = {
  accountEmail: '',
  serviceName: 'Netflix',
}

const sanitizeNumericInput = (value: string) => {
  const cleaned = value.replace(/[^\d.]/g, '')
  const firstDot = cleaned.indexOf('.')
  if (firstDot === -1) return cleaned
  const integerPart = cleaned.slice(0, firstDot + 1)
  const decimalPart = cleaned.slice(firstDot + 1).replace(/\./g, '')
  return `${integerPart}${decimalPart}`
}

function uniqueById<T extends { id: string }>(items: T[]) {
  const seen = new Set<string>()
  return items.filter(item => {
    if (seen.has(item.id)) return false
    seen.add(item.id)
    return true
  })
}

function dedupeProducts(items: PanelProduct[]) {
  const seen = new Set<string>()
  return items.filter(item => {
    const compositeKey = [
      item.id,
      item.ownerId,
      item.ownerUsername,
      item.providerName,
      item.title,
      item.createdAt,
    ].join('::')
    if (seen.has(compositeKey)) return false
    seen.add(compositeKey)
    return true
  })
}

function normalizePanelPayload(payload: PanelBootstrapPayload): PanelBootstrapPayload {
  return {
    ...payload,
    accounts: uniqueById(payload.accounts || []),
    supportRequests: uniqueById(payload.supportRequests || []).map(request => ({
      ...request,
      messages: uniqueById(request.messages || []),
    })),
    supportHistory: uniqueById(payload.supportHistory || []),
    products: dedupeProducts(payload.products || []),
    sales: uniqueById(payload.sales || []),
    allUsers: uniqueById(payload.allUsers || []).map(user => ({
      ...user,
      accounts: uniqueById(user.accounts || []),
    })),
  }
}

function removeAccountFromPayload(
  payload: PanelBootstrapPayload,
  accountId: string
): PanelBootstrapPayload {
  const idsToRemove = new Set<string>([accountId])
  let changed = true
  while (changed) {
    changed = false
    for (const account of payload.accounts || []) {
      if (account.parentAccountId && idsToRemove.has(account.parentAccountId) && !idsToRemove.has(account.id)) {
        idsToRemove.add(account.id)
        changed = true
      }
    }
    for (const user of payload.allUsers || []) {
      for (const account of user.accounts || []) {
        if (account.parentAccountId && idsToRemove.has(account.parentAccountId) && !idsToRemove.has(account.id)) {
          idsToRemove.add(account.id)
          changed = true
        }
      }
    }
  }

  return normalizePanelPayload({
    ...payload,
    accounts: (payload.accounts || []).filter(account => !idsToRemove.has(account.id)),
    allUsers: (payload.allUsers || []).map(user => {
      const nextAccounts = (user.accounts || []).filter(account => !idsToRemove.has(account.id))
      return {
        ...user,
        activeAccounts: nextAccounts.filter(account => account.status === 'activa').length,
        accounts: nextAccounts,
      }
    }),
  })
}

function replaceAccountEmailInPayload(
  payload: PanelBootstrapPayload,
  accountId: string,
  accountEmail: string
): PanelBootstrapPayload {
  const targetAccount =
    (payload.accounts || []).find(account => account.id === accountId) ||
    (payload.allUsers || []).flatMap(user => user.accounts || []).find(account => account.id === accountId)
  const rootAccountId = targetAccount?.rootAccountId || targetAccount?.id || accountId
  const shouldReplace = (account: PanelAccount) =>
    account.id === accountId || account.id === rootAccountId || account.rootAccountId === rootAccountId

  return normalizePanelPayload({
    ...payload,
    accounts: (payload.accounts || []).map(account =>
      shouldReplace(account) ? { ...account, accountEmail, updatedAt: new Date().toISOString() } : account
    ),
    supportRequests: (payload.supportRequests || []).map(request =>
      request.accountId === accountId ? { ...request, accountEmail, updatedAt: new Date().toISOString() } : request
    ),
    allUsers: (payload.allUsers || []).map(user => ({
      ...user,
      accounts: (user.accounts || []).map(account =>
        shouldReplace(account) ? { ...account, accountEmail, updatedAt: new Date().toISOString() } : account
      ),
    })),
  })
}

function updateAccountsInPayload(
  payload: PanelBootstrapPayload,
  accounts: PanelAccount[]
): PanelBootstrapPayload {
  if (accounts.length === 0) return payload
  const byId = new Map(accounts.map(account => [account.id, account]))

  return normalizePanelPayload({
    ...payload,
    accounts: (payload.accounts || []).map(account => byId.get(account.id) || account),
    allUsers: (payload.allUsers || []).map(user => ({
      ...user,
      accounts: (user.accounts || []).map(account => byId.get(account.id) || account),
    })),
  })
}

function appendAccountsToPayload(
  payload: PanelBootstrapPayload,
  accounts: PanelAccount[]
): PanelBootstrapPayload {
  if (accounts.length === 0) return payload

  return normalizePanelPayload({
    ...payload,
    accounts: [...accounts, ...(payload.accounts || []).filter(account => !accounts.some(item => item.id === account.id))],
    allUsers: (payload.allUsers || []).map(user => {
      const userNewAccounts = accounts.filter(account => account.assignedUserId === user.id)
      if (userNewAccounts.length === 0) return user

      const mergedAccounts = [
        ...userNewAccounts,
        ...(user.accounts || []).filter(account => !userNewAccounts.some(item => item.id === account.id)),
      ]

      return {
        ...user,
        activeAccounts: mergedAccounts.filter(account => account.status === 'activa').length,
        accounts: mergedAccounts,
      }
    }),
  })
}

function SectionIcon({ icon }: { icon: SectionIconName }) {
  if (icon === 'wallet') {
    return (
      <svg viewBox='0 0 24 24' aria-hidden='true'>
        <path d='M4 7.5A2.5 2.5 0 0 1 6.5 5h9A2.5 2.5 0 0 1 18 7.5V8h1a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H6.5A2.5 2.5 0 0 1 4 15.5v-8Z' />
        <path d='M16 12h4' />
        <path d='M6 8h12' />
      </svg>
    )
  }

  if (icon === 'chat') {
    return (
      <svg viewBox='0 0 24 24' aria-hidden='true'>
        <path d='M7 18.5 3.5 20V7a2 2 0 0 1 2-2h13A2.5 2.5 0 0 1 21 7.5v7a2.5 2.5 0 0 1-2.5 2.5H7Z' />
        <path d='M8 10h8' />
        <path d='M8 13h5' />
      </svg>
    )
  }

  if (icon === 'users') {
    return (
      <svg viewBox='0 0 24 24' aria-hidden='true'>
        <path d='M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z' />
        <path d='M16.5 10a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z' />
        <path d='M4.5 19a4.5 4.5 0 0 1 9 0' />
        <path d='M14 18a3.5 3.5 0 0 1 6 0' />
      </svg>
    )
  }

  if (icon === 'card') {
    return (
      <svg viewBox='0 0 24 24' aria-hidden='true'>
        <path d='M4 7.5A2.5 2.5 0 0 1 6.5 5h11A2.5 2.5 0 0 1 20 7.5v9a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 16.5v-9Z' />
        <path d='M4 9.5h16' />
        <path d='M8 15h3' />
      </svg>
    )
  }

  if (icon === 'crown') {
    return (
      <svg viewBox='0 0 24 24' aria-hidden='true'>
        <path d='m4 17 1.7-8 4.3 3 2-4 2 4 4.3-3L20 17Z' />
        <path d='M6 20h12' />
      </svg>
    )
  }

  if (icon === 'bell') {
    return (
      <svg viewBox='0 0 24 24' aria-hidden='true'>
        <path d='M6 16h12' />
        <path d='M8 16V11a4 4 0 1 1 8 0v5' />
        <path d='M10 19a2 2 0 0 0 4 0' />
      </svg>
    )
  }

  if (icon === 'spark') {
    return (
      <svg viewBox='0 0 24 24' aria-hidden='true'>
        <path d='m12 4 1.4 4.6L18 10l-4.6 1.4L12 16l-1.4-4.6L6 10l4.6-1.4Z' />
        <path d='M18.5 4.5v3' />
        <path d='M20 6h-3' />
      </svg>
    )
  }

  if (icon === 'clock') {
    return (
      <svg viewBox='0 0 24 24' aria-hidden='true'>
        <path d='M12 20a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z' />
        <path d='M12 8v4l2.5 1.5' />
      </svg>
    )
  }

  if (icon === 'settings') {
    return (
      <svg viewBox='0 0 24 24' aria-hidden='true'>
        <path d='M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z' />
        <path d='m19 12 2-1.5-2-3.5-2.4 1a7 7 0 0 0-1.2-.7L15 4h-4l-.4 3.3a7 7 0 0 0-1.2.7L7 7l-2 3.5L7 12l-2 1.5L7 17l2.4-1a7 7 0 0 0 1.2.7L11 20h4l.4-3.3a7 7 0 0 0 1.2-.7L19 17l2-3.5Z' />
      </svg>
    )
  }

  if (icon === 'send') {
    return (
      <svg viewBox='0 0 24 24' aria-hidden='true'>
        <path d='M21 4 3.5 11.5l6.2 2.3L12 20l3.1-5.2L21 4Z' />
        <path d='m9.7 13.8 5.4-5.4' />
      </svg>
    )
  }

  return (
    <svg viewBox='0 0 24 24' aria-hidden='true'>
      <path d='M12 3.5 5 6.5v5c0 4.3 2.7 7.4 7 9 4.3-1.6 7-4.7 7-9v-5l-7-3Z' />
      <path d='m9.5 12 1.7 1.7L14.8 10' />
    </svg>
  )
}

const formatDate = (value: string | null) => {
  if (!value) return '-'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return '-'
  return parsed.toLocaleDateString('es-PE', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

const formatDateTime = (value: string | null) => {
  if (!value) return '-'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return '-'
  return parsed.toLocaleString('es-PE', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

const formatMoney = (value: number) =>
  new Intl.NumberFormat('es-PE', {
    style: 'currency',
    currency: 'PEN',
    minimumFractionDigits: 2,
  }).format(value)

const getSafeDaysRemaining = (value: number | null) => {
  if (value === null || Number.isNaN(value)) return null
  return Math.max(0, value)
}

const getDaysTone = (value: number | null): 'success' | 'warning' | 'danger' | 'muted' => {
  if (value === null) return 'muted'
  const safeValue = getSafeDaysRemaining(value)
  if (safeValue === null) return 'muted'
  if (safeValue <= 0) return 'danger'
  if (safeValue <= 7) return 'warning'
  return 'success'
}

async function fileToDataUrl(file: File | null) {
  if (!file) return null

  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(new Error('No se pudo leer la imagen.'))
    reader.readAsDataURL(file)
  })
}

export default function PanelPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [panelData, setPanelData] = useState<PanelBootstrapPayload | null>(null)
  const [panelView, setPanelView] = useState<PanelView>('usuario')
  const [activeSection, setActiveSection] = useState<PanelSectionId>('cuentas')
  const [selectedRequestId, setSelectedRequestId] = useState<string | null>(null)
  const [expandedUserId, setExpandedUserId] = useState<string | null>('all')
  const [ownerUserSearch, setOwnerUserSearch] = useState('')
  const [ownerAccountSearch, setOwnerAccountSearch] = useState('')
  const [childUserSearch, setChildUserSearch] = useState('')
  const [childExpandedUserId, setChildExpandedUserId] = useState<string | null>('all')
  const [childAccountSearch, setChildAccountSearch] = useState('')
  const [childAccountFilter, setChildAccountFilter] = useState<OwnerAccountFilter>('todos')
  const [ownerAccountFilter, setOwnerAccountFilter] = useState<OwnerAccountFilter>('todos')
  const [userAccountFilter, setUserAccountFilter] = useState<UserAccountFilter>('todos')
  const [supportChoiceAccount, setSupportChoiceAccount] = useState<PanelAccount | null>(null)
  const [issueAccount, setIssueAccount] = useState<PanelAccount | null>(null)
  const [renewalAccount, setRenewalAccount] = useState<PanelAccount | null>(null)
  const [removeConfirmAccount, setRemoveConfirmAccount] = useState<PanelAccount | null>(null)
  const [replacementEmail, setReplacementEmail] = useState('')
  const [buyProduct, setBuyProduct] = useState<PanelProduct | null>(null)
  const [assignOpen, setAssignOpen] = useState(false)
  const [productOpen, setProductOpen] = useState(false)
  const [pendingUserOpen, setPendingUserOpen] = useState(false)
  const [pendingUsername, setPendingUsername] = useState('')
  const [childAssignOpen, setChildAssignOpen] = useState(false)
  const [childAssignUserId, setChildAssignUserId] = useState('')
  const [childAssignAccountId, setChildAssignAccountId] = useState('')
  const [childAssignCutoffDate, setChildAssignCutoffDate] = useState('')
  const [childAssignSearch, setChildAssignSearch] = useState('')
  const [childAssignAccountSearch, setChildAssignAccountSearch] = useState('')
  const [childAssignPickerOpen, setChildAssignPickerOpen] = useState(false)
  const [childAccountPickerOpen, setChildAccountPickerOpen] = useState(false)
  const [assignSearch, setAssignSearch] = useState('')
  const [assignUserId, setAssignUserId] = useState('')
  const [assignPickerOpen, setAssignPickerOpen] = useState(false)
  const [assignExcelFileName, setAssignExcelFileName] = useState('')
  const [assignExcelDataUrl, setAssignExcelDataUrl] = useState<string | null>(null)
  const [assignExcelPreview, setAssignExcelPreview] = useState<ExcelAssignPreview | null>(null)
  const [issueForm, setIssueForm] = useState<SupportIssueForm>(defaultIssueForm)
  const [messageForm, setMessageForm] = useState<SupportMessageForm>(defaultMessageForm)
  const [renewalProofDataUrl, setRenewalProofDataUrl] = useState<string | null>(null)
  const [purchaseProofDataUrl, setPurchaseProofDataUrl] = useState<string | null>(null)
  const [assignForm, setAssignForm] = useState<AssignForm>(defaultAssignForm)
  const [editAccountOpen, setEditAccountOpen] = useState(false)
  const [editAccountForm, setEditAccountForm] = useState<AccountEditForm>(defaultAccountEditForm)
  const [productForm, setProductForm] = useState<ProductForm>(defaultProductForm())
  const [settingsForm, setSettingsForm] = useState<SettingsForm>(defaultSettingsForm)
  const [telegramAccounts, setTelegramAccounts] = useState<TelegramAccount[]>([])
  const [telegramForm, setTelegramForm] = useState<TelegramForm>(defaultTelegramForm)
  const [telegramLoading, setTelegramLoading] = useState(false)
  const [pageByKey, setPageByKey] = useState<Record<string, number>>({})
  const [seenSupportMap, setSeenSupportMap] = useState<Record<string, string>>({})
  const realtimeRefreshRef = useRef<number | null>(null)
  const realtimePollRef = useRef<number | null>(null)
  const refreshInFlightRef = useRef(false)
  const refreshQueuedRef = useRef(false)
  const productCreatePendingRef = useRef(false)

  const profile = panelData?.profile ?? null
  const panelRole: PanelRole = profile?.role || 'usuario'
  const canEditAccountIdentity = panelRole === 'owner' && panelView === 'owner'

  const getCurrentPage = (key: string, totalItems: number) => {
    const totalPages = Math.max(1, Math.ceil(totalItems / PAGE_SIZE))
    const rawPage = pageByKey[key] || 1
    return Math.min(Math.max(rawPage, 1), totalPages)
  }

  const getPageItems = <T,>(key: string, items: T[]) => {
    const page = getCurrentPage(key, items.length)
    const start = (page - 1) * PAGE_SIZE
    return items.slice(start, start + PAGE_SIZE)
  }

  const setListPage = (key: string, nextPage: number, totalItems: number) => {
    const totalPages = Math.max(1, Math.ceil(totalItems / PAGE_SIZE))
    const safePage = Math.min(Math.max(nextPage, 1), totalPages)
    setPageByKey(current => ({
      ...current,
      [key]: safePage,
    }))
  }

  const isSubclientProfile = Boolean(profile?.parentId)

  const visibleSections = useMemo(
    () =>
      panelView === 'owner'
        ? OWNER_SECTIONS
        : USER_SECTIONS.filter(section => !isSubclientProfile || section.id !== 'compras'),
    [isSubclientProfile, panelView]
  )

  const currentSection =
    visibleSections.find(section => section.id === activeSection) || visibleSections[0]

  const userSupportRequests = useMemo(
    () => (panelData?.supportRequests || []).filter(item => item.requesterId === profile?.id),
    [panelData?.supportRequests, profile?.id]
  )

  const ownerSupportRequests = useMemo(
    () => (panelData?.supportRequests || []).filter(item => item.ownerId === profile?.id),
    [panelData?.supportRequests, profile?.id]
  )

  const currentRequests = panelView === 'owner' ? ownerSupportRequests : userSupportRequests
  const currentHistory = useMemo(
    () =>
      panelView === 'owner'
        ? (panelData?.supportHistory || []).filter(item => item.ownerId === profile?.id)
        : (panelData?.supportHistory || []).filter(item => item.requesterId === profile?.id),
    [panelData?.supportHistory, panelView, profile?.id]
  )

  const selectedRequest =
    currentRequests.find(item => item.id === selectedRequestId) || currentRequests[0] || null

  const getSupportSeenMarker = (request: PanelSupportRequest) => {
    const lastMessage = request.messages?.[request.messages.length - 1] || null
    return lastMessage?.createdAt || `${request.status}:${request.updatedAt}`
  }

  const requestNeedsAttention = (request: PanelSupportRequest) => {
    const marker = getSupportSeenMarker(request)
    if (seenSupportMap[request.id] === marker) return false
    if (request.status === 'cierre_solicitado' && request.requesterId === profile?.id) return true
    const lastMessage = request.messages?.[request.messages.length - 1] || null
    return Boolean(lastMessage && lastMessage.senderId !== profile?.id)
  }

  const userSupportAttentionCount = useMemo(
    () => userSupportRequests.filter(request => requestNeedsAttention(request)).length,
    [profile?.id, seenSupportMap, userSupportRequests]
  )

  const userSupportAccountIds = useMemo(
    () => new Set(userSupportRequests.map(request => request.accountId).filter(Boolean) as string[]),
    [userSupportRequests]
  )

  const ownerProducts = useMemo(
    () =>
      (panelData?.products || []).filter(
        item =>
          item.ownerId === profile?.id ||
          item.ownerUsername === profile?.username ||
          item.providerName === profile?.username
      ),
    [panelData?.products, profile?.id, profile?.username]
  )

  const ownerSales = useMemo(
    () =>
      (panelData?.sales || []).filter(
        item =>
          item.ownerId === profile?.id ||
          item.ownerUsername === profile?.username ||
          item.providerNameSnapshot === profile?.username
      ),
    [panelData?.sales, profile?.id, profile?.username]
  )

  const searchableUsers = useMemo(() => {
    const rawUsers = panelData?.allUsers || []
    const term = assignSearch.trim().toLowerCase()
    if (!term) return rawUsers
    return rawUsers.filter(item => item.username.toLowerCase().includes(term))
  }, [assignSearch, panelData?.allUsers])

  const productSpecialUsers = useMemo(() => {
    const rawUsers = panelData?.allUsers || []
    const term = productForm.search.trim().toLowerCase()
    if (!term) return rawUsers
    return rawUsers.filter(item => item.username.toLowerCase().includes(term))
  }, [panelData?.allUsers, productForm.search])

  const selectedAssignUser = useMemo(
    () => (panelData?.allUsers || []).find(user => user.id === assignUserId) || null,
    [assignUserId, panelData?.allUsers]
  )

  const childUsers = useMemo(() => panelData?.allUsers || [], [panelData?.allUsers])

  const filteredChildUsers = useMemo(() => {
    const term = childUserSearch.trim().toLowerCase()
    return childUsers
      .filter(user => (!term ? true : user.username.toLowerCase().includes(term)))
      .sort((left, right) => right.activeAccounts - left.activeAccounts)
  }, [childUserSearch, childUsers])

  const childAssignableUsers = useMemo(() => {
    const term = childAssignSearch.trim().toLowerCase()
    if (!term) return childUsers
    return childUsers.filter(user => user.username.toLowerCase().includes(term))
  }, [childAssignSearch, childUsers])

  const selectedChildAssignUser = useMemo(
    () => childUsers.find(user => user.id === childAssignUserId) || null,
    [childAssignUserId, childUsers]
  )

  const ownPanelAccounts = useMemo(
    () => (panelData?.accounts || []).filter(account => account.assignedUserId === profile?.id),
    [panelData?.accounts, profile?.id]
  )

  const childAssignableAccounts = useMemo(() => {
    const term = childAssignAccountSearch.trim().toLowerCase()
    if (!term) return ownPanelAccounts
    return ownPanelAccounts.filter(account =>
      [account.serviceName, account.accountEmail, account.accountType, account.ownerUsername]
        .join(' ')
        .toLowerCase()
        .includes(term)
    )
  }, [childAssignAccountSearch, ownPanelAccounts])

  const selectedChildAssignAccount = useMemo(
    () => ownPanelAccounts.find(account => account.id === childAssignAccountId) || null,
    [childAssignAccountId, ownPanelAccounts]
  )

  const childAllAccounts = useMemo(
    () =>
      childUsers
        .flatMap(user => user.accounts.map(account => ({ ...account, clientUsername: user.username })))
        .sort((left, right) => {
          const leftDays = getSafeDaysRemaining(left.daysRemaining) ?? 9999
          const rightDays = getSafeDaysRemaining(right.daysRemaining) ?? 9999
          return leftDays - rightDays
        }),
    [childUsers]
  )

  const selectedChildUser =
    childExpandedUserId && childExpandedUserId !== 'all'
      ? childUsers.find(user => user.id === childExpandedUserId) || null
      : null

  const filteredChildAccounts = useMemo(() => {
    const baseAccounts =
      childExpandedUserId === 'all'
        ? childAllAccounts
        : (selectedChildUser?.accounts || []).map(account => ({
            ...account,
            clientUsername: selectedChildUser?.username || 'usuario',
          }))

    return baseAccounts.filter(account => {
      const term = childAccountSearch.trim().toLowerCase()
      if (
        term &&
        ![account.accountEmail, account.clientUsername, account.serviceName, account.ownerUsername]
          .join(' ')
          .toLowerCase()
          .includes(term)
      ) {
        return false
      }

      const safeDays = getSafeDaysRemaining(account.daysRemaining)
      if (childAccountFilter === 'vigentes') return safeDays !== null && safeDays > 7
      if (childAccountFilter === 'por_vencer') return safeDays !== null && safeDays > 0 && safeDays <= 7
      if (childAccountFilter === 'vencidas') return safeDays !== null && safeDays <= 0
      return true
    })
  }, [childAccountFilter, childAccountSearch, childAllAccounts, childExpandedUserId, selectedChildUser])

  const assignHasInlineData = assignForm.emailsText.includes('|')
  const assignHasInlineUsers = assignForm.emailsText
    .split(/\r?\n/)
    .some(line => line.split('|').length >= 3)

  const bulkUserSuggestionTerm = useMemo(() => {
    const lines = assignForm.emailsText.split(/\r?\n/)
    const lastLineWithUser = [...lines].reverse().find(line => line.split('|').length >= 3)
    if (!lastLineWithUser) return ''
    const parts = lastLineWithUser.split('|')
    return String(parts[2] || '').trim().toLowerCase()
  }, [assignForm.emailsText])

  const bulkUserSuggestions = useMemo(() => {
    if (!bulkUserSuggestionTerm) return []
    return (panelData?.allUsers || [])
      .filter(user => user.username.toLowerCase().includes(bulkUserSuggestionTerm))
      .slice(0, 5)
  }, [bulkUserSuggestionTerm, panelData?.allUsers])

  const ownerUsers = useMemo(() => {
    const rawUsers = panelData?.allUsers || []
    const term = ownerUserSearch.trim().toLowerCase()

    return rawUsers
      .filter(user => (!term ? true : user.username.toLowerCase().includes(term)))
      .sort((left, right) => {
        const dateDiff = new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()
        if (Number.isFinite(dateDiff) && dateDiff !== 0) {
          return dateDiff
        }
        return right.activeAccounts - left.activeAccounts
      })
  }, [ownerUserSearch, panelData?.allUsers])

  const ownerAllAccounts = useMemo(
    () =>
      (panelData?.allUsers || [])
        .flatMap(user => user.accounts.map(account => ({ ...account, clientUsername: user.username })))
        .sort((left, right) => {
          const leftDays = getSafeDaysRemaining(left.daysRemaining) ?? 9999
          const rightDays = getSafeDaysRemaining(right.daysRemaining) ?? 9999
          return leftDays - rightDays
        }),
    [panelData?.allUsers]
  )

  const selectedOwnerUser =
    expandedUserId && expandedUserId !== 'all'
      ? (panelData?.allUsers || []).find(user => user.id === expandedUserId) || null
      : null

  const filteredOwnerAccounts = useMemo(() => {
    const baseAccounts =
      expandedUserId === 'all'
        ? ownerAllAccounts
        : (selectedOwnerUser?.accounts || []).map(account => ({
            ...account,
            clientUsername: selectedOwnerUser?.username || 'usuario',
          }))

    return baseAccounts.filter(account => {
      const term = ownerAccountSearch.trim().toLowerCase()
      if (
        term &&
        ![
          account.accountEmail,
          account.clientUsername,
          account.serviceName,
          account.ownerUsername,
        ]
          .join(' ')
          .toLowerCase()
          .includes(term)
      ) {
        return false
      }

      const safeDays = getSafeDaysRemaining(account.daysRemaining)

      if (ownerAccountFilter === 'vigentes') {
        return safeDays !== null && safeDays > 7
      }

      if (ownerAccountFilter === 'por_vencer') {
        return safeDays !== null && safeDays > 0 && safeDays <= 7
      }

      if (ownerAccountFilter === 'vencidas') {
        return safeDays !== null && safeDays <= 0
      }

      return true
    })
  }, [expandedUserId, ownerAccountSearch, ownerAllAccounts, ownerAccountFilter, selectedOwnerUser])

  useEffect(() => {
    let active = true

    const boot = async () => {
      const sessionResp = await supabase.auth.getSession()
      const session = sessionResp.data.session

      if (!active) return

      if (!session) {
        router.replace('/')
        return
      }

      await refreshPanel()
    }

    void boot()

    return () => {
      active = false
    }
  }, [router])

  useEffect(() => {
    if (panelRole === 'owner') {
      setPanelView('owner')
      if (!OWNER_SECTIONS.some(section => section.id === activeSection)) {
        setActiveSection('solicitudes')
      }
    } else {
      setPanelView('usuario')
    }
  }, [activeSection, panelRole])

  useEffect(() => {
    if (!profile?.id) return

    try {
      const raw = window.localStorage.getItem(`panel-support-seen-${profile.id}`)
      setSeenSupportMap(raw ? JSON.parse(raw) : {})
    } catch {
      setSeenSupportMap({})
    }
  }, [profile?.id])

  useEffect(() => {
    if (!profile?.id) return

    try {
      window.localStorage.setItem(`panel-support-seen-${profile.id}`, JSON.stringify(seenSupportMap))
    } catch {
      // Local storage can be blocked; notifications still work for the current render.
    }
  }, [profile?.id, seenSupportMap])

  useEffect(() => {
    if (panelView === 'owner') {
      if (!OWNER_SECTIONS.some(section => section.id === activeSection)) {
        setActiveSection('solicitudes')
      }
    } else if (!USER_SECTIONS.some(section => section.id === activeSection)) {
      setActiveSection('cuentas')
    }
  }, [activeSection, panelView])

  useEffect(() => {
    if (!currentRequests.length) {
      setSelectedRequestId(null)
      return
    }

    if (!selectedRequestId || !currentRequests.some(item => item.id === selectedRequestId)) {
      setSelectedRequestId(currentRequests[0].id)
    }
  }, [currentRequests, selectedRequestId])

  useEffect(() => {
    if (!selectedRequest) return
    if (activeSection !== 'soporte' && activeSection !== 'solicitudes') return

    const marker = getSupportSeenMarker(selectedRequest)
    setSeenSupportMap(current =>
      current[selectedRequest.id] === marker ? current : { ...current, [selectedRequest.id]: marker }
    )
  }, [activeSection, selectedRequest?.id, selectedRequest?.status, selectedRequest?.updatedAt, selectedRequest?.messages])

  useEffect(() => {
    setReplacementEmail(selectedRequest?.accountEmail || '')
  }, [selectedRequest?.id, selectedRequest?.accountEmail])

  useEffect(() => {
    if (profile?.username) {
      setProductForm(current => ({ ...current, providerName: current.providerName || profile.username }))
    }
  }, [profile?.username])

  useEffect(() => {
    if (panelView !== 'owner' || activeSection !== 'telegram') return
    void fetchTelegramAccounts()
  }, [activeSection, panelView])

  useEffect(() => {
    if (isSubclientProfile && activeSection === 'compras') {
      setActiveSection('cuentas')
    }
  }, [activeSection, isSubclientProfile])

  useEffect(() => {
    if (!profile?.id) return

    const scheduleRefresh = () => {
      if (realtimeRefreshRef.current) {
        window.clearTimeout(realtimeRefreshRef.current)
      }

      realtimeRefreshRef.current = window.setTimeout(() => {
        void refreshPanel(true)
      }, 25)
    }

    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') {
        void refreshPanel(true)
      }
    }

    realtimePollRef.current = window.setInterval(refreshWhenVisible, 1000)
    window.addEventListener('focus', refreshWhenVisible)
    document.addEventListener('visibilitychange', refreshWhenVisible)

    const channel = supabase
      .channel(`panel-live-${profile.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, scheduleRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'service_accounts' }, scheduleRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'support_requests' }, scheduleRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'support_messages' }, scheduleRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'support_request_history' }, scheduleRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'panel_products' }, scheduleRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'telegram_code_accounts' }, () => {
        scheduleRefresh()
        if (panelView === 'owner' && activeSection === 'telegram') {
          void fetchTelegramAccounts()
        }
      })
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'panel_product_special_prices' },
        scheduleRefresh
      )
      .on('postgres_changes', { event: '*', schema: 'public', table: 'panel_sales' }, scheduleRefresh)
      .subscribe()

    return () => {
      if (realtimeRefreshRef.current) {
        window.clearTimeout(realtimeRefreshRef.current)
      }
      if (realtimePollRef.current) {
        window.clearInterval(realtimePollRef.current)
      }
      window.removeEventListener('focus', refreshWhenVisible)
      document.removeEventListener('visibilitychange', refreshWhenVisible)
      void supabase.removeChannel(channel)
    }
  }, [activeSection, panelView, profile?.id])

  const getAccessToken = async () => {
    const sessionResp = await supabase.auth.getSession()
    const token = sessionResp.data.session?.access_token
    if (!token) {
      router.replace('/')
      throw new Error('Tu sesion ya no existe.')
    }
    return token
  }

  const refreshPanel = async (silent = false) => {
    if (refreshInFlightRef.current) {
      refreshQueuedRef.current = true
      return
    }

    refreshInFlightRef.current = true
    if (!silent) {
      setLoading(true)
    }
    setError('')
    try {
      const token = await getAccessToken()
      const response = await fetch(`/api/panel/bootstrap?ts=${Date.now()}`, {
        method: 'GET',
        cache: 'no-store',
        headers: {
          Authorization: `Bearer ${token}`,
          'Cache-Control': 'no-cache',
          Pragma: 'no-cache',
        },
      })

      const payload = (await response.json().catch(() => ({}))) as PanelBootstrapPayload & {
        error?: string
      }

      if (!response.ok || payload.error) {
        throw new Error(payload.error || 'No se pudo cargar el panel.')
      }

      const normalizedPayload = normalizePanelPayload(payload)
      setPanelData(normalizedPayload)
      if (normalizedPayload.profile.role === 'owner') {
        setPanelView('owner')
        if (!OWNER_SECTIONS.some(section => section.id === activeSection)) {
          setActiveSection('solicitudes')
        }
      } else {
        setPanelView('usuario')
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'No se pudo cargar el panel.')
    } finally {
      if (!silent) {
        setLoading(false)
      }
      refreshInFlightRef.current = false
      if (refreshQueuedRef.current) {
        refreshQueuedRef.current = false
        void refreshPanel(true)
      }
    }
  }

  const callPanelApi = async (path: string, body: Record<string, unknown>) => {
    const token = await getAccessToken()
    const response = await fetch(path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    })

    const payload = (await response.json().catch(() => ({}))) as PanelApiPayload

    if (!response.ok || payload.error) {
      throw new Error(payload.error || 'No se pudo completar la accion.')
    }

    return payload
  }

  const fetchTelegramAccounts = async () => {
    setTelegramLoading(true)
    setError('')
    try {
      const token = await getAccessToken()
      const response = await fetch('/api/panel/telegram', {
        method: 'GET',
        cache: 'no-store',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      })

      const payload = (await response.json().catch(() => ({}))) as {
        accounts?: TelegramAccount[]
        error?: string
      }

      if (!response.ok || payload.error) {
        throw new Error(payload.error || 'No se pudo cargar Telegram.')
      }

      setTelegramAccounts(payload.accounts || [])
    } catch (telegramError) {
      setTelegramAccounts([])
      setError(telegramError instanceof Error ? telegramError.message : 'No se pudo cargar Telegram.')
    } finally {
      setTelegramLoading(false)
    }
  }

  const submitTelegramAccount = async () => {
    setSaving(true)
    setError('')
    try {
      const payload = await callPanelApi('/api/panel/telegram', {
        action: 'create',
        accountEmail: telegramForm.accountEmail,
        serviceName: telegramForm.serviceName,
      })

      setTelegramForm(defaultTelegramForm)
      setNotice(payload.message || 'Cuenta Telegram guardada.')
      await fetchTelegramAccounts()
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'No se pudo guardar la cuenta Telegram.')
    } finally {
      setSaving(false)
    }
  }

  const toggleTelegramAccount = async (account: TelegramAccount) => {
    setSaving(true)
    setError('')
    try {
      const payload = await callPanelApi('/api/panel/telegram', {
        action: 'toggle',
        accountId: account.id,
      })

      setNotice(payload.message || 'Cuenta Telegram actualizada.')
      await fetchTelegramAccounts()
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'No se pudo actualizar Telegram.')
    } finally {
      setSaving(false)
    }
  }

  const deleteTelegramAccount = async (account: TelegramAccount) => {
    setSaving(true)
    setError('')
    try {
      const payload = await callPanelApi('/api/panel/telegram', {
        action: 'delete',
        accountId: account.id,
      })

      setNotice(payload.message || 'Cuenta Telegram eliminada.')
      setTelegramAccounts(current => current.filter(item => item.id !== account.id))
      await fetchTelegramAccounts()
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'No se pudo eliminar Telegram.')
    } finally {
      setSaving(false)
    }
  }

  const handleSignOut = async () => {
    await supabase.auth.signOut()
    router.replace('/')
  }

  const updateSettingsField = (field: keyof SettingsForm, value: string) => {
    const nextValue =
      field === 'currentPin' || field === 'nextPin' || field === 'nextPinConfirm'
        ? value.replace(/\D/g, '').slice(0, 4)
        : value

    setSettingsForm(current => ({
      ...current,
      [field]: nextValue,
    }))
  }

  const updatePasswordSettings = async () => {
    setSaving(true)
    setError('')
    try {
      const payload = await callPanelApi('/api/panel/settings', {
        action: 'password',
        currentPassword: settingsForm.currentPassword,
        nextPassword: settingsForm.nextPassword,
        nextPasswordConfirm: settingsForm.nextPasswordConfirm,
      })

      setSettingsForm(current => ({
        ...current,
        currentPassword: '',
        nextPassword: '',
        nextPasswordConfirm: '',
      }))
      setNotice(payload.message || 'Contrasena actualizada.')
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'No se pudo cambiar la contrasena.')
    } finally {
      setSaving(false)
    }
  }

  const updatePinSettings = async () => {
    setSaving(true)
    setError('')
    try {
      const payload = await callPanelApi('/api/panel/settings', {
        action: 'pin',
        currentPin: settingsForm.currentPin,
        nextPin: settingsForm.nextPin,
        nextPinConfirm: settingsForm.nextPinConfirm,
      })

      setSettingsForm(current => ({
        ...current,
        currentPin: '',
        nextPin: '',
        nextPinConfirm: '',
      }))
      setNotice(payload.message || 'Codigo actualizado.')
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'No se pudo cambiar el codigo.')
    } finally {
      setSaving(false)
    }
  }

  const submitSupportIssue = async () => {
    if (!issueAccount) return
    setSaving(true)
    setError('')
    try {
      await callPanelApi('/api/panel/accounts', {
        action: 'support_issue',
        accountId: issueAccount.id,
        subject: issueForm.subject,
        description: issueForm.description,
      })
      setIssueAccount(null)
      setIssueForm(defaultIssueForm)
      setActiveSection('soporte')
      setNotice('Soporte enviado.')
      await refreshPanel()
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'No se pudo enviar el soporte.')
    } finally {
      setSaving(false)
    }
  }

  const submitNoPayment = async (account: PanelAccount) => {
    setSaving(true)
    setError('')
    try {
      const payload = await callPanelApi('/api/panel/accounts', {
        action: 'support_no_payment',
        accountId: account.id,
      })
      setSupportChoiceAccount(null)
      setActiveSection('soporte')
      setNotice(payload.message || 'Solicitud enviada.')
      await refreshPanel()
      if (payload.requestId) setSelectedRequestId(payload.requestId)
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'No se pudo abrir la solicitud.')
    } finally {
      setSaving(false)
    }
  }

  const submitRenewal = async () => {
    if (!renewalAccount) return
    if (isSubclientProfile) {
      setRenewalAccount(null)
      setRenewalProofDataUrl(null)
      setError('Los subclientes no pueden solicitar renovacion.')
      return
    }
    setSaving(true)
    setError('')
    try {
      const payload = await callPanelApi('/api/panel/accounts', {
        action: 'renewal',
        accountId: renewalAccount.id,
        paymentProofDataUrl: renewalProofDataUrl,
      })
      setRenewalAccount(null)
      setRenewalProofDataUrl(null)
      setActiveSection('soporte')
      setNotice(payload.message || 'Renovacion enviada.')
      await refreshPanel()
      if (payload.requestId) setSelectedRequestId(payload.requestId)
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'No se pudo enviar la renovacion.')
    } finally {
      setSaving(false)
    }
  }

  const submitChatMessage = async () => {
    if (!selectedRequest) return
    const optimisticBody = messageForm.body.trim()
    const optimisticImage = messageForm.imageDataUrl
    setSaving(true)
    setError('')
    try {
      const optimisticMessageId = `local-${Date.now()}`
      if (optimisticBody || optimisticImage) {
        patchSupportRequest(selectedRequest.id, request => ({
          ...request,
          status: 'en_chat',
          updatedAt: new Date().toISOString(),
          messages: [
            ...request.messages,
            {
              id: optimisticMessageId,
              requestId: request.id,
              senderId: profile?.id || 'local-user',
              senderUsername: profile?.username || 'Tú',
              senderRole: profile?.role || 'usuario',
              body: optimisticBody || 'Imagen adjunta',
              imageDataUrl: optimisticImage,
              createdAt: new Date().toISOString(),
            },
          ],
        }))
      }

      await callPanelApi('/api/panel/requests', {
        action: 'message',
        requestId: selectedRequest.id,
        body: messageForm.body,
        imageDataUrl: messageForm.imageDataUrl,
      })
      setMessageForm(defaultMessageForm)
      setNotice('Mensaje enviado.')
      void refreshPanel(true)
    } catch (submitError) {
      void refreshPanel(true)
      setError(submitError instanceof Error ? submitError.message : 'No se pudo enviar el mensaje.')
    } finally {
      setSaving(false)
    }
  }

  const updateRequestStatus = async (requestId: string, status: string) => {
    setSaving(true)
    setError('')
    try {
      patchSupportRequest(requestId, request => ({
        ...request,
        status: status as PanelSupportRequest['status'],
        updatedAt: new Date().toISOString(),
      }))
      await callPanelApi('/api/panel/requests', {
        action: 'status',
        requestId,
        status,
      })
      setNotice('Solicitud actualizada.')
      void refreshPanel(true)
    } catch (submitError) {
      void refreshPanel(true)
      setError(submitError instanceof Error ? submitError.message : 'No se pudo actualizar la solicitud.')
    } finally {
      setSaving(false)
    }
  }

  const closeRequestFlow = async (requestId: string, action: 'request_close' | 'confirm_close') => {
    setSaving(true)
    setError('')
    try {
      const requestSnapshot =
        panelData?.supportRequests.find(item => item.id === requestId) || selectedRequest || null

      await callPanelApi('/api/panel/requests', {
        action,
        requestId,
      })
      if (action === 'request_close') {
        patchSupportRequest(requestId, request => ({
          ...request,
          status: 'cierre_solicitado',
          updatedAt: new Date().toISOString(),
        }))
        setNotice('Cierre enviado para confirmacion.')
      } else {
        setPanelData(current =>
          {
            if (!current) return current

            const removedRequest = current.supportRequests.find(item => item.id === requestId) || requestSnapshot
            const optimisticHistory =
              removedRequest
                ? ([
                    {
                      id: `history-${removedRequest.id}`,
                      accountEmail: removedRequest.accountEmail,
                      serviceName: removedRequest.serviceName,
                      requesterId: removedRequest.requesterId,
                      requesterUsername: removedRequest.requesterUsername,
                      ownerId: removedRequest.ownerId,
                      ownerUsername: removedRequest.ownerUsername,
                      requestKind: removedRequest.requestKind,
                      subject: removedRequest.subject,
                      description: removedRequest.description,
                      summary: `${removedRequest.subject} · ${removedRequest.serviceName || 'Servicio'} · ${(removedRequest.messages || []).length} mensajes`,
                      messageCount: (removedRequest.messages || []).length,
                      lastMessagePreview:
                        removedRequest.messages && removedRequest.messages.length > 0
                          ? removedRequest.messages[removedRequest.messages.length - 1].body
                          : null,
                      closedById: profile?.id || null,
                      closedByUsername: profile?.username || null,
                      closedAt: new Date().toISOString(),
                      createdAt: removedRequest.createdAt,
                    } satisfies PanelSupportHistory,
                    ...current.supportHistory,
                  ] as PanelSupportHistory[])
                : current.supportHistory

            return {
              ...current,
              supportRequests: current.supportRequests.filter(item => item.id !== requestId),
              supportHistory: uniqueById(optimisticHistory),
            }
          }
        )
        setSelectedRequestId(null)
        setNotice('Ticket cerrado y movido a historial.')
      }
      void refreshPanel(true)
    } catch (submitError) {
      void refreshPanel(true)
      setError(submitError instanceof Error ? submitError.message : 'No se pudo cerrar el ticket.')
    } finally {
      setSaving(false)
    }
  }

  const replaceSupportAccountEmail = async (request: PanelSupportRequest) => {
    const nextEmail = replacementEmail.trim().toLowerCase()
    if (!request.accountId) {
      setError('Esta solicitud no tiene una cuenta vinculada para reemplazar.')
      return
    }

    if (!nextEmail) {
      setError('Ingresa el correo nuevo para reemplazar la cuenta.')
      return
    }

    setSaving(true)
    setError('')
    try {
      setPanelData(current =>
        current ? replaceAccountEmailInPayload(current, request.accountId || '', nextEmail) : current
      )
      const payload = await callPanelApi('/api/panel/requests', {
        action: 'replace_account_email',
        requestId: request.id,
        accountEmail: nextEmail,
      })
      setNotice(payload.message || 'Correo reemplazado exitosamente.')
      void refreshPanel(true)
    } catch (submitError) {
      void refreshPanel(true)
      setError(submitError instanceof Error ? submitError.message : 'No se pudo reemplazar el correo.')
    } finally {
      setSaving(false)
    }
  }

  const submitPurchase = async () => {
    if (!buyProduct) return
    setSaving(true)
    setError('')
    try {
      await callPanelApi('/api/panel/products', {
        action: 'purchase',
        productId: buyProduct.id,
        paymentProofDataUrl: purchaseProofDataUrl,
      })
      setBuyProduct(null)
      setPurchaseProofDataUrl(null)
      setNotice('Compra enviada al proveedor.')
      await refreshPanel()
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'No se pudo registrar la compra.')
    } finally {
      setSaving(false)
    }
  }

  const parseAssignDate = (value: string) => {
    const raw = value.trim()
    if (!raw) return ''

    const slashMatch = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
    if (slashMatch) {
      const day = slashMatch[1].padStart(2, '0')
      const month = slashMatch[2].padStart(2, '0')
      const year = slashMatch[3]
      const date = new Date(`${year}-${month}-${day}T00:00:00`)
      if (
        Number.isNaN(date.getTime()) ||
        date.getUTCFullYear() !== Number(year) ||
        date.getUTCMonth() + 1 !== Number(month) ||
        date.getUTCDate() !== Number(day)
      ) {
        throw new Error(`Fecha invalida: ${raw}`)
      }
      return `${year}-${month}-${day}`
    }

    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw
    throw new Error(`Usa fecha dd/mm/aaaa o aaaa-mm-dd: ${raw}`)
  }

  const resolveAssignUserId = (username: string) => {
    const normalized = username.trim().toLowerCase()
    const match = (panelData?.allUsers || []).find(user => user.username.toLowerCase() === normalized)
    if (!match) {
      throw new Error(`No encontre el usuario "${username}" en profiles.`)
    }
    return match.id
  }

  const applyBulkUserSuggestion = (username: string) => {
    setAssignForm(current => {
      const lines = current.emailsText.split(/\r?\n/)
      const targetIndex = [...lines].map((line, index) => ({ line, index })).reverse().find(
        item => item.line.split('|').length >= 3
      )?.index

      if (targetIndex === undefined) return current

      const parts = lines[targetIndex].split('|')
      parts[2] = username
      lines[targetIndex] = parts.join('|')
      return {
        ...current,
        emailsText: lines.join('\n'),
      }
    })
  }

  const resetAssignModal = () => {
    setAssignOpen(false)
    setAssignForm(defaultAssignForm)
    setAssignSearch('')
    setAssignUserId('')
    setAssignPickerOpen(false)
    setAssignExcelFileName('')
    setAssignExcelDataUrl(null)
    setAssignExcelPreview(null)
  }

  const previewExcelAssign = async () => {
    if (!assignExcelDataUrl) {
      setError('Sube un Excel primero.')
      return
    }

    setSaving(true)
    setError('')
    try {
      const payload = await callPanelApi('/api/panel/accounts', {
        action: 'preview_excel',
        fileDataUrl: assignExcelDataUrl,
        serviceName: assignForm.serviceName,
        accountType: assignForm.accountType,
      })

      setAssignExcelPreview(payload.excelPreview || null)
      setNotice(payload.message || 'Excel previsualizado.')
    } catch (previewError) {
      setAssignExcelPreview(null)
      setError(previewError instanceof Error ? previewError.message : 'No se pudo leer el Excel.')
    } finally {
      setSaving(false)
    }
  }

  const confirmExcelAssign = async () => {
    const assignments = assignExcelPreview?.assignments || []
    if (assignments.length === 0) {
      setError('No hay cuentas validas para confirmar.')
      return
    }

    setSaving(true)
    setError('')
    try {
      const payload = await callPanelApi('/api/panel/accounts', {
        action: 'assign',
        assignments,
        renewalPrice: Number(assignForm.renewalPrice || 0),
        renewalPeriodDays: Number(assignForm.renewalPeriodDays || 30),
        status: 'activa',
      })

      if (payload.accounts?.length) {
        setPanelData(current => (current ? appendAccountsToPayload(current, payload.accounts || []) : current))
        setExpandedUserId(assignments[0]?.userId || 'all')
      }

      resetAssignModal()
      setActiveSection('asignacion')
      setNotice(payload.message || 'Cuentas importadas desde Excel.')
      await refreshPanel(true)
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'No se pudo importar el Excel.')
    } finally {
      setSaving(false)
    }
  }

  const submitAssign = async () => {
    setSaving(true)
    setError('')
    try {
      const rawLines = assignForm.emailsText
        .split(/\r?\n/)
        .map(item => item.trim())
        .filter(Boolean)
      const usesInlineData = rawLines.some(line => line.includes('|'))
      const assignments = rawLines.flatMap(line => {
        if (!line.includes('|')) {
          if (!assignUserId) {
            throw new Error('Selecciona un usuario para asignarle la cuenta.')
          }

          return line
            .split(',')
            .map(email => email.trim().toLowerCase())
            .filter(Boolean)
            .map(email => ({
              email,
              userId: assignUserId,
              cutoffDate: assignForm.cutoffDate || null,
            }))
        }

        const parts = line.split('|').map(item => item.trim())
        const emailsPart = parts[0] || ''
        const cutoffDate = parseAssignDate(parts[1] || '')
        const inlineUsername = parts[2] || ''
        const targetUserId = inlineUsername ? resolveAssignUserId(inlineUsername) : assignUserId

        if (!targetUserId) {
          throw new Error('Cuando uses | sin usuario por linea, selecciona un usuario arriba.')
        }

        return emailsPart
          .split(',')
          .map(email => email.trim().toLowerCase())
          .filter(Boolean)
          .map(email => ({
            email,
            userId: targetUserId,
            cutoffDate,
          }))
      })

      if (assignments.length === 0) {
        throw new Error('Agrega al menos un correo para asignar.')
      }

      const payload = await callPanelApi('/api/panel/accounts', {
        action: 'assign',
        userId: usesInlineData ? undefined : assignUserId,
        emails: usesInlineData ? undefined : assignments.map(item => item.email),
        assignments: usesInlineData ? assignments : undefined,
        serviceName: assignForm.serviceName,
        accountType: assignForm.accountType,
        cutoffDate: usesInlineData ? undefined : assignForm.cutoffDate,
        renewalPrice: Number(assignForm.renewalPrice || 0),
        renewalPeriodDays: Number(assignForm.renewalPeriodDays || 30),
        status: 'activa',
      })

      if (payload.accounts?.length) {
        setPanelData(current => (current ? appendAccountsToPayload(current, payload.accounts || []) : current))
        setExpandedUserId(assignments[0]?.userId || assignUserId || 'all')
      }

      resetAssignModal()
      setActiveSection('asignacion')
      setNotice(payload.message || 'Cuenta asignada.')
      await refreshPanel(true)
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'No se pudo asignar la cuenta.')
    } finally {
      setSaving(false)
    }
  }

  const submitPendingUser = async () => {
    setSaving(true)
    setError('')
    try {
      const isOwnerBulk = panelRole === 'owner' && /[,\n\r]/.test(pendingUsername)
      const payload = await callPanelApi('/api/subcliente', {
        action: isOwnerBulk ? 'create_pending_many' : 'create_pending',
        username: pendingUsername,
      })

      setPendingUserOpen(false)
      setPendingUsername('')
      const omittedCount = payload.omitted?.length || 0
      setNotice(
        omittedCount > 0
          ? `${payload.message || 'Usuarios procesados.'} Omitidos: ${payload.omitted
              ?.slice(0, 3)
              .map(item => `${item.username || 'usuario'} (${item.reason})`)
              .join(', ')}`
          : payload.message || 'Usuario pendiente creado.'
      )
      await refreshPanel(true)
      const firstCreatedUser = payload.user || payload.users?.[0]
      if (firstCreatedUser?.id && panelRole === 'owner') {
        setExpandedUserId(firstCreatedUser.id)
        setActiveSection('vip')
      }
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'No se pudo crear el usuario.')
    } finally {
      setSaving(false)
    }
  }

  const submitChildAssign = async () => {
    setSaving(true)
    setError('')
    try {
      const payload = await callPanelApi('/api/panel/accounts', {
        action: 'delegate',
        accountId: childAssignAccountId,
        userId: childAssignUserId,
        cutoffDate: childAssignCutoffDate || undefined,
      })

      if (payload.accounts?.length) {
        setPanelData(current => (current ? appendAccountsToPayload(current, payload.accounts || []) : current))
      }

      setChildAssignOpen(false)
      setChildAssignUserId('')
      setChildAssignAccountId('')
      setChildAssignCutoffDate('')
      setChildAssignSearch('')
      setChildAssignAccountSearch('')
      setChildAssignPickerOpen(false)
      setChildAccountPickerOpen(false)
      setNotice(payload.message || 'Cuenta asignada al subcliente.')
      await refreshPanel(true)
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'No se pudo asignar al subcliente.')
    } finally {
      setSaving(false)
    }
  }

  const removeAccount = async (accountId: string) => {
    const snapshot = panelData
    setRemoveConfirmAccount(null)
    setSaving(true)
    setError('')
    try {
      setPanelData(current => (current ? removeAccountFromPayload(current, accountId) : current))
      setSupportChoiceAccount(current => (current?.id === accountId ? null : current))
      setIssueAccount(current => (current?.id === accountId ? null : current))
      setRenewalAccount(current => (current?.id === accountId ? null : current))

      await callPanelApi('/api/panel/accounts', {
        action: 'remove',
        accountId,
      })
      setNotice('Cuenta retirada.')
      await refreshPanel(true)
    } catch (submitError) {
      if (snapshot) {
        setPanelData(snapshot)
      }
      void refreshPanel(true)
      setError(submitError instanceof Error ? submitError.message : 'No se pudo quitar la cuenta.')
    } finally {
      setSaving(false)
    }
  }

  const openEditAccount = (account: PanelAccount) => {
    setEditAccountForm({
      id: account.id,
      serviceName: account.serviceName,
      accountEmail: account.accountEmail,
      accountType: account.accountType,
      cutoffDate: account.cutoffDate || '',
      renewalPrice: String(account.renewalPrice || ''),
      renewalPeriodDays: String(account.renewalPeriodDays || 30),
      status: account.status,
    })
    setEditAccountOpen(true)
  }

  const submitEditAccount = async () => {
    setSaving(true)
    setError('')
    try {
      const payload = await callPanelApi('/api/panel/accounts', {
        action: 'update',
        accountId: editAccountForm.id,
        nextEmail: editAccountForm.accountEmail,
        serviceName: editAccountForm.serviceName,
        accountType: editAccountForm.accountType,
        cutoffDate: editAccountForm.cutoffDate || null,
        renewalPrice: Number(editAccountForm.renewalPrice || 0),
        renewalPeriodDays: Number(editAccountForm.renewalPeriodDays || 30),
        status: editAccountForm.status,
      })

      if (payload.accounts?.length) {
        setPanelData(current => (current ? updateAccountsInPayload(current, payload.accounts || []) : current))
      }

      setEditAccountOpen(false)
      setEditAccountForm(defaultAccountEditForm)
      setNotice(payload.message || 'Cuenta actualizada.')
      await refreshPanel(true)
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'No se pudo editar la cuenta.')
    } finally {
      setSaving(false)
    }
  }

  const exportOwnerAccounts = async () => {
    const rows = filteredOwnerAccounts.map(account => ({
      Servicio: account.serviceName,
      Cuenta: account.accountEmail,
      Tipo: account.accountType,
      Estado: account.status,
      Cliente: account.clientUsername,
      Propietario: account.ownerUsername,
      Corte: account.cutoffDate || '',
      Dias: getSafeDaysRemaining(account.daysRemaining) ?? '',
    }))

    const XLSX = await import('xlsx')
    const worksheet = XLSX.utils.json_to_sheet(rows)
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Cuentas')
    XLSX.writeFile(workbook, `cuentas-owner-${new Date().toISOString().slice(0, 10)}.xlsx`)
  }

  const addSpecialPriceRow = () => {
    if (!productForm.pendingUserId || !productForm.pendingSpecialPrice) return
    setProductForm(current => ({
      ...current,
      pendingUserId: '',
      pendingSpecialPrice: '',
      specialRows: [
        ...current.specialRows.filter(item => item.userId !== current.pendingUserId),
        {
          userId: current.pendingUserId,
          specialPrice: current.pendingSpecialPrice,
        },
      ],
    }))
  }

  const submitProduct = async () => {
    if (productCreatePendingRef.current) return
    productCreatePendingRef.current = true
    setSaving(true)
    setError('')
    try {
      const payload = (await callPanelApi('/api/panel/products', {
        action: 'create',
        title: productForm.title,
        providerName: profile?.username || productForm.providerName,
        price: Number(productForm.price || 0),
        inStock: productForm.inStock,
        imageDataUrl: productForm.imageDataUrl,
        specialPrices: productForm.specialRows.map(item => ({
          userId: item.userId,
          specialPrice: Number(item.specialPrice || 0),
        })),
      })) as {
        message?: string
        product?: PanelProduct
      }
      if (payload.product) {
        setPanelData(current =>
          current
            ? normalizePanelPayload({
                ...current,
                products: [payload.product as PanelProduct, ...current.products],
              })
            : current
        )
      }
      setProductOpen(false)
      setProductForm(defaultProductForm(profile?.username || ''))
      setNotice(payload.message || 'Producto creado.')
      void refreshPanel(true)
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'No se pudo crear el producto.')
    } finally {
      productCreatePendingRef.current = false
      setSaving(false)
    }
  }

  const toggleStock = async (productId: string) => {
    setSaving(true)
    setError('')
    try {
      await callPanelApi('/api/panel/products', {
        action: 'toggle_stock',
        productId,
      })
      setPanelData(current =>
        current
          ? {
              ...current,
              products: current.products.map(item =>
                item.id === productId ? { ...item, inStock: !item.inStock } : item
              ),
            }
          : current
      )
      setNotice('Stock actualizado.')
      void refreshPanel(true)
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'No se pudo cambiar el stock.')
    } finally {
      setSaving(false)
    }
  }

  const deleteProduct = async (product: PanelProduct) => {
    setSaving(true)
    setError('')
    try {
      await callPanelApi('/api/panel/products', {
        action: 'delete',
        productId: product.id,
      })
      setPanelData(current =>
        current
          ? {
              ...current,
              products: current.products.filter(
                item =>
                  item.id !== product.id &&
                  !(
                    item.title === product.title &&
                    item.providerName === product.providerName &&
                    (item.ownerId === product.ownerId || item.ownerUsername === product.ownerUsername)
                  )
              ),
            }
          : current
      )
      setBuyProduct(current => (current?.id === product.id ? null : current))
      setNotice('Producto eliminado.')
      await refreshPanel(true)
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'No se pudo borrar el producto.')
    } finally {
      setSaving(false)
    }
  }

  const updateSaleStatus = async (saleId: string, status: string) => {
    setSaving(true)
    setError('')
    try {
      await callPanelApi('/api/panel/sales', {
        saleId,
        status,
      })
      setNotice('Venta actualizada.')
      await refreshPanel()
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'No se pudo actualizar la venta.')
    } finally {
      setSaving(false)
    }
  }

  const renderSectionButtons = (navClassName: string) => (
    <nav className={navClassName} aria-label='Apartados del panel'>
      {visibleSections.map(section => {
        const count =
          section.id === 'solicitudes'
            ? ownerSupportRequests.length
            : section.id === 'soporte'
              ? userSupportAttentionCount || userSupportRequests.length
              : null

        return (
          <button
            key={section.id}
            type='button'
            className={section.id === activeSection ? styles.navItemActive : styles.navItem}
            onClick={() => setActiveSection(section.id)}
          >
            <span className={styles.navIcon}>
              <SectionIcon icon={section.icon} />
            </span>
            <span className={styles.navBody}>
              <strong>{section.label}</strong>
            </span>
            {count !== null && <span className={styles.navCount}>{count}</span>}
          </button>
        )
      })}
    </nav>
  )

  const renderStatusBadge = (status: string) => (
    <span
      className={
        status === 'activa' || status === 'aprobada' || status === 'pagada'
          ? styles.badgeSuccess
          : status === 'pendiente' || status === 'pendiente_revision' || status === 'cierre_solicitado'
            ? styles.badgeWarning
            : status === 'sin_pago' || status === 'rechazada' || status === 'cancelada'
              ? styles.badgeDanger
              : styles.badgeMuted
      }
    >
      {status.replace(/_/g, ' ')}
    </span>
  )

  const renderDaysBadge = (value: number | null) => {
    const safeValue = getSafeDaysRemaining(value)
    const tone = getDaysTone(value)
    const badgeClass =
      tone === 'success'
        ? styles.badgeSuccess
        : tone === 'warning'
          ? styles.badgeWarning
          : tone === 'danger'
            ? styles.badgeDanger
            : styles.badgeMuted

    return <span className={badgeClass}>{safeValue === null ? 'Sin fecha' : `${safeValue} dias`}</span>
  }

  const renderPagination = (key: string, totalItems: number) => {
    if (totalItems <= PAGE_SIZE) return null

    const page = getCurrentPage(key, totalItems)
    const totalPages = Math.max(1, Math.ceil(totalItems / PAGE_SIZE))
    const start = (page - 1) * PAGE_SIZE + 1
    const end = Math.min(page * PAGE_SIZE, totalItems)

    return (
      <div className={styles.paginationBar}>
        <span>
          {start}-{end} de {totalItems}
        </span>
        <div className={styles.paginationActions}>
          <button
            type='button'
            className={styles.ghostButton}
            onClick={() => setListPage(key, page - 1, totalItems)}
            disabled={page <= 1}
          >
            Anterior
          </button>
          <span className={styles.pagePill}>
            {page}/{totalPages}
          </span>
          <button
            type='button'
            className={styles.secondaryButton}
            onClick={() => setListPage(key, page + 1, totalItems)}
            disabled={page >= totalPages}
          >
            Siguiente
          </button>
        </div>
      </div>
    )
  }

  const renderProductStockBadge = (inStock: boolean) => (
    <span className={inStock ? styles.productStockLive : styles.productStockOff}>
      {inStock ? 'Activa' : 'Sin stock'}
    </span>
  )

  const patchSupportRequest = (
    requestId: string,
    updater: (request: PanelSupportRequest) => PanelSupportRequest
  ) => {
    setPanelData(current =>
      current
        ? {
            ...current,
            supportRequests: current.supportRequests.map(item =>
              item.id === requestId ? updater(item) : item
            ),
          }
        : current
    )
  }

  const handleFileChange = async (
    event: ChangeEvent<HTMLInputElement>,
    callback: (value: string | null) => void
  ) => {
    try {
      const file = event.target.files?.[0] || null
      callback(await fileToDataUrl(file))
    } catch (fileError) {
      setError(fileError instanceof Error ? fileError.message : 'No se pudo leer la imagen.')
    }
  }

  const renderAccountsSection = () => {
    const accounts = ownPanelAccounts
    const accountCounts = {
      todos: accounts.length,
      vigentes: accounts.filter(account => {
        const days = getSafeDaysRemaining(account.daysRemaining)
        return days !== null && days > 7
      }).length,
      por_vencer: accounts.filter(account => {
        const days = getSafeDaysRemaining(account.daysRemaining)
        return days !== null && days > 0 && days <= 7
      }).length,
      vencidas: accounts.filter(account => {
        const days = getSafeDaysRemaining(account.daysRemaining)
        return days !== null && days <= 0
      }).length,
      soporte: accounts.filter(account => userSupportAccountIds.has(account.id)).length,
    }
    const filteredAccounts = accounts.filter(account => {
      const days = getSafeDaysRemaining(account.daysRemaining)

      if (userAccountFilter === 'vigentes') return days !== null && days > 7
      if (userAccountFilter === 'por_vencer') return days !== null && days > 0 && days <= 7
      if (userAccountFilter === 'vencidas') return days !== null && days <= 0
      if (userAccountFilter === 'soporte') return userSupportAccountIds.has(account.id)

      return true
    })
    const pageKey = `user-accounts-${userAccountFilter}`
    const pageAccounts = getPageItems(pageKey, filteredAccounts)
    const filterOptions: Array<{ id: UserAccountFilter; label: string; count: number }> = [
      { id: 'todos', label: 'Todos', count: accountCounts.todos },
      { id: 'vigentes', label: 'Vigentes', count: accountCounts.vigentes },
      { id: 'por_vencer', label: 'Por vencer', count: accountCounts.por_vencer },
      { id: 'vencidas', label: 'Vencidas', count: accountCounts.vencidas },
      { id: 'soporte', label: 'En soporte', count: accountCounts.soporte },
    ]

    return (
      <div className={styles.sectionStack}>
        <div className={styles.blockCard}>
          <div className={styles.blockHeader}>
            <div>
              <span className={styles.blockEyebrow}>Cuentas registradas</span>
              <h3>Tus cuentas activas</h3>
            </div>
          </div>

          <div className={styles.inlineTabs}>
            {filterOptions.map(option => (
              <button
                key={option.id}
                type='button'
                className={userAccountFilter === option.id ? styles.tabActive : styles.tabButton}
                onClick={() => setUserAccountFilter(option.id)}
              >
                {option.label}
                <span className={styles.tabCount}>{option.count}</span>
              </button>
            ))}
          </div>

          {accounts.length === 0 ? (
            <div className={styles.emptyCard}>Todavia no tienes cuentas asignadas.</div>
          ) : filteredAccounts.length === 0 ? (
            <div className={styles.emptyCard}>No hay cuentas en este filtro.</div>
          ) : (
            <>
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Servicio</th>
                      <th>Correo</th>
                      <th>Tipo</th>
                      <th>Propietario</th>
                      <th>Fecha de corte</th>
                      <th>Dias restantes</th>
                      <th>Estado</th>
                      <th>Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pageAccounts.map(account => (
                      <tr key={account.id}>
                        <td>{account.serviceName}</td>
                        <td>{account.accountEmail}</td>
                        <td>{account.accountType}</td>
                        <td>{account.ownerUsername}</td>
                        <td>{formatDate(account.cutoffDate)}</td>
                        <td>{renderDaysBadge(account.daysRemaining)}</td>
                        <td>{renderStatusBadge(account.status)}</td>
                        <td>
                          <div className={styles.inlineActions}>
                            <button
                              type='button'
                              className={styles.secondaryButton}
                              onClick={() => setSupportChoiceAccount(account)}
                            >
                              Soporte
                            </button>
                            {!isSubclientProfile && (
                              <button
                                type='button'
                                className={styles.primaryButton}
                                onClick={() => setRenewalAccount(account)}
                              >
                                Renovacion
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className={styles.cardGrid}>
                {pageAccounts.map(account => (
                  <article key={`${account.id}-card`} className={styles.miniCard}>
                    <div className={styles.miniCardHead}>
                      <strong>{account.serviceName}</strong>
                      {renderStatusBadge(account.status)}
                    </div>
                    <p>{account.accountEmail}</p>
                    <span>Owner: {account.ownerUsername}</span>
                    <span>Corte: {formatDate(account.cutoffDate)}</span>
                    <span className={styles.accountMetaRow}>
                      <span>Dias restantes</span>
                      {renderDaysBadge(account.daysRemaining)}
                    </span>
                    <div className={styles.inlineActions}>
                      <button
                        type='button'
                        className={styles.secondaryButton}
                        onClick={() => setSupportChoiceAccount(account)}
                      >
                        Soporte
                      </button>
                      {!isSubclientProfile && (
                        <button
                          type='button'
                          className={styles.primaryButton}
                          onClick={() => setRenewalAccount(account)}
                        >
                          Renovacion
                        </button>
                      )}
                    </div>
                  </article>
                ))}
              </div>

              {renderPagination(pageKey, filteredAccounts.length)}
            </>
          )}
        </div>
      </div>
    )
  }

  const renderSupportSection = (ownerMode: boolean) => (
    <div className={styles.sectionSplit}>
      <div className={styles.blockCard}>
        <div className={styles.blockHeader}>
          <div>
            <span className={styles.blockEyebrow}>{ownerMode ? 'Solicitudes' : 'Soporte'}</span>
            <h3>{ownerMode ? 'Chats y renovaciones' : 'Tus solicitudes activas'}</h3>
          </div>
        </div>

        {currentRequests.length === 0 ? (
          <div className={styles.emptyCard}>Todavia no hay solicitudes en esta vista.</div>
        ) : (
          <div className={styles.requestList}>
            {currentRequests.map(request => (
              <button
                key={request.id}
                type='button'
                className={request.id === selectedRequest?.id ? styles.requestItemActive : styles.requestItem}
                onClick={() => setSelectedRequestId(request.id)}
              >
                <div>
                  <strong>{request.subject}</strong>
                  <span>
                    {request.serviceName || 'Sin cuenta'} · {request.accountEmail || 'Sin correo'}
                  </span>
                </div>
                <div className={styles.requestMeta}>
                  {renderStatusBadge(request.status)}
                  <span>{formatDateTime(request.createdAt)}</span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className={styles.blockCard}>
        {selectedRequest ? (
          <>
            <div className={styles.blockHeader}>
              <div>
                <span className={styles.blockEyebrow}>{selectedRequest.requestKind}</span>
                <h3>{selectedRequest.subject}</h3>
              </div>
              {renderStatusBadge(selectedRequest.status)}
            </div>

            <div className={styles.detailStack}>
              <div className={styles.detailLine}>
                <strong>Cuenta:</strong>
                <span>{selectedRequest.accountEmail || 'Sin cuenta vinculada'}</span>
              </div>
              <div className={styles.detailLine}>
                <strong>{ownerMode ? 'Cliente:' : 'Proveedor:'}</strong>
                <span>{ownerMode ? selectedRequest.requesterUsername : selectedRequest.ownerUsername}</span>
              </div>
              {selectedRequest.renewalPrice !== null && (
                <div className={styles.detailLine}>
                  <strong>Precio de renovacion:</strong>
                  <span>{formatMoney(selectedRequest.renewalPrice)}</span>
                </div>
              )}
              {selectedRequest.description && (
                <div className={styles.descriptionBox}>{selectedRequest.description}</div>
              )}
              {selectedRequest.paymentProofDataUrl && (
                <img
                  className={styles.proofImage}
                  src={selectedRequest.paymentProofDataUrl}
                  alt='Comprobante enviado'
                />
              )}
            </div>

            <div className={styles.chatBox}>
              {(selectedRequest.messages || []).length === 0 ? (
                <div className={styles.emptyChat}>Aun no hay mensajes en este chat.</div>
              ) : (
                selectedRequest.messages.map(message => (
                  <article
                    key={message.id}
                    className={
                      message.senderId === profile?.id ? styles.messageMine : styles.messageOther
                    }
                  >
                    <div className={styles.messageMeta}>
                      <strong>{message.senderUsername}</strong>
                      <span>{formatDateTime(message.createdAt)}</span>
                    </div>
                    <p>{message.body}</p>
                    {message.imageDataUrl && (
                      <img className={styles.messageImage} src={message.imageDataUrl} alt='Adjunto del chat' />
                    )}
                  </article>
                ))
              )}
            </div>

            <div className={styles.composerCard}>
              <label className={styles.fieldLabel}>
                <span>Mensaje para el chat</span>
                <textarea
                  className={styles.textarea}
                  placeholder='Escribe tu respuesta o detalle adicional.'
                  value={messageForm.body}
                  onChange={event => setMessageForm(current => ({ ...current, body: event.target.value }))}
                />
              </label>
              <div className={styles.composerActions}>
                <label className={styles.fieldLabel}>
                  <span>Imagen opcional</span>
                  <span className={styles.fileButton}>
                    Adjuntar imagen
                    <input
                      type='file'
                      accept='image/*'
                      onChange={event =>
                        void handleFileChange(event, value =>
                          setMessageForm(current => ({ ...current, imageDataUrl: value }))
                        )
                      }
                    />
                  </span>
                </label>
                <button
                  type='button'
                  className={styles.primaryButton}
                  onClick={() => void submitChatMessage()}
                  disabled={saving}
                >
                  Enviar
                </button>
              </div>
            </div>

            {ownerMode && (
              <div className={styles.inlineActions}>
                <button
                  type='button'
                  className={styles.ghostButton}
                  onClick={() => void closeRequestFlow(selectedRequest.id, 'request_close')}
                  disabled={saving}
                >
                  Cerrar ticket
                </button>
              </div>
            )}
            {!ownerMode && selectedRequest.status === 'cierre_solicitado' && (
              <div className={styles.inlineActions}>
                <button
                  type='button'
                  className={styles.primaryButton}
                  onClick={() => void closeRequestFlow(selectedRequest.id, 'confirm_close')}
                  disabled={saving}
                >
                  Si todo conforme
                </button>
              </div>
            )}
          </>
        ) : (
          <div className={styles.emptyCard}>Selecciona una solicitud para ver el chat y sus acciones.</div>
        )}
      </div>
    </div>
  )

  const renderGestionSection = () => {
    const usersPageKey = 'child-users'
    const accountsPageKey = `child-accounts-${childExpandedUserId}-${childAccountFilter}`
    const pageChildUsers = getPageItems(usersPageKey, filteredChildUsers)
    const pageChildAccounts = getPageItems(accountsPageKey, filteredChildAccounts)

    return (
      <div className={styles.sectionStack}>
        <div className={styles.ownerUsersLayout}>
          <div className={styles.blockCard}>
            <div className={styles.blockHeader}>
              <div>
                <span className={styles.blockEyebrow}>Usuarios</span>
                <h3>Mis usuarios</h3>
              </div>
              <div className={styles.inlineActions}>
                <button type='button' className={styles.secondaryButton} onClick={() => setChildAssignOpen(true)}>
                  Asignar cuenta
                </button>
                <button type='button' className={styles.primaryButton} onClick={() => setPendingUserOpen(true)}>
                  Crear usuario
                </button>
              </div>
            </div>

            <div className={styles.ownerUserRail}>
              <input
                className={styles.input}
                placeholder='Buscar usuario'
                value={childUserSearch}
                onChange={event => setChildUserSearch(event.target.value)}
              />

              <div className={styles.ownerUserList}>
                <button
                  type='button'
                  className={childExpandedUserId === 'all' ? styles.ownerUserOptionActive : styles.ownerUserOption}
                  onClick={() => setChildExpandedUserId('all')}
                >
                  <div className={styles.ownerUserMain}>
                    <strong>Todos</strong>
                  </div>
                  <strong className={styles.ownerUserCount}>({childAllAccounts.length})</strong>
                </button>

                {filteredChildUsers.length === 0 ? (
                  <div className={styles.emptyCard}>Crea usuarios pendientes y pasales /subcliente.</div>
                ) : (
                  pageChildUsers.map(user => (
                    <button
                      key={user.id}
                      type='button'
                      className={
                        childExpandedUserId === user.id ? styles.ownerUserOptionActive : styles.ownerUserOption
                      }
                      onClick={() => setChildExpandedUserId(user.id)}
                    >
                      <div className={styles.ownerUserMain}>
                        <strong>{user.username}</strong>
                      </div>
                      <strong className={styles.ownerUserCount}>({user.accounts.length})</strong>
                    </button>
                  ))
                )}
                {renderPagination(usersPageKey, filteredChildUsers.length)}
              </div>
            </div>
          </div>

          <div className={styles.blockCard}>
            <div className={styles.ownerPanelHeader}>
              <div>
                <span className={styles.blockEyebrow}>
                  {childExpandedUserId === 'all' ? 'General' : 'Cliente'}
                </span>
                <h3>
                  {childExpandedUserId === 'all'
                    ? 'Cuentas asignadas a tus usuarios'
                    : `Cuentas de ${selectedChildUser?.username || 'usuario'}`}
                </h3>
              </div>
              <div className={styles.inlineTabs}>
                <button
                  type='button'
                  className={childAccountFilter === 'todos' ? styles.tabActive : styles.tabButton}
                  onClick={() => setChildAccountFilter('todos')}
                >
                  Todos
                </button>
                <button
                  type='button'
                  className={childAccountFilter === 'vigentes' ? styles.tabActive : styles.tabButton}
                  onClick={() => setChildAccountFilter('vigentes')}
                >
                  Vigentes
                </button>
                <button
                  type='button'
                  className={childAccountFilter === 'por_vencer' ? styles.tabActive : styles.tabButton}
                  onClick={() => setChildAccountFilter('por_vencer')}
                >
                  7 dias o menos
                </button>
                <button
                  type='button'
                  className={childAccountFilter === 'vencidas' ? styles.tabActive : styles.tabButton}
                  onClick={() => setChildAccountFilter('vencidas')}
                >
                  Vencidas
                </button>
              </div>
            </div>

            <div className={styles.ownerAccountTools}>
              <input
                className={styles.input}
                placeholder='Buscar por correo, cliente o servicio'
                value={childAccountSearch}
                onChange={event => setChildAccountSearch(event.target.value)}
              />
            </div>

            {filteredChildAccounts.length === 0 ? (
              <div className={styles.emptyCard}>No hay cuentas para ese filtro.</div>
            ) : (
              <>
                <div className={styles.tableWrap}>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th>Servicio</th>
                        <th>Correo</th>
                        <th>Cliente</th>
                        <th>Propietario</th>
                        <th>Corte</th>
                        <th>Dias</th>
                        <th>Estado</th>
                        <th>Acciones</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pageChildAccounts.map(account => (
                        <tr key={account.id}>
                          <td>{account.serviceName}</td>
                          <td>{account.accountEmail}</td>
                          <td>{account.clientUsername}</td>
                          <td>{account.ownerUsername}</td>
                          <td>{formatDate(account.cutoffDate)}</td>
                          <td>{renderDaysBadge(account.daysRemaining)}</td>
                          <td>{renderStatusBadge(account.status)}</td>
                          <td>
                            <div className={styles.inlineActions}>
                              <button
                                type='button'
                                className={styles.iconActionButton}
                                title='Editar datos'
                                onClick={() => openEditAccount(account)}
                              >
                                ✏️
                              </button>
                              <button
                                type='button'
                                className={styles.iconDangerButton}
                                title='Quitar cuenta'
                                onClick={() => setRemoveConfirmAccount(account)}
                              >
                                🗑️
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {renderPagination(accountsPageKey, filteredChildAccounts.length)}
              </>
            )}
          </div>
        </div>
      </div>
    )
  }

  const renderHistorialSection = (ownerMode: boolean) => {
    const pageKey = ownerMode ? 'owner-history' : 'user-history'
    const pageHistory = getPageItems(pageKey, currentHistory)

    return (
    <div className={styles.sectionStack}>
      <div className={styles.blockCard}>
        <div className={styles.blockHeader}>
          <div>
            <span className={styles.blockEyebrow}>Historial</span>
            <h3>{ownerMode ? 'Tickets archivados' : 'Tus tickets cerrados'}</h3>
          </div>
        </div>

        {currentHistory.length === 0 ? (
          <div className={styles.emptyCard}>Todavia no hay tickets cerrados en historial.</div>
        ) : (
          <>
          <div className={styles.cardGrid}>
            {pageHistory.map(item => (
              <article key={item.id} className={styles.miniCard}>
                <div className={styles.miniCardHead}>
                  <strong>{item.subject}</strong>
                  <span className={styles.badgeMuted}>{item.requestKind.replace(/_/g, ' ')}</span>
                </div>
                <p>{item.summary}</p>
                <span>{item.serviceName || 'Sin servicio'} · {item.accountEmail || 'Sin correo'}</span>
                <span>{ownerMode ? `Cliente: ${item.requesterUsername}` : `Proveedor: ${item.ownerUsername}`}</span>
                {item.lastMessagePreview && <span>Ultimo: {item.lastMessagePreview}</span>}
                <span>Cerrado: {formatDateTime(item.closedAt)}</span>
              </article>
            ))}
          </div>
          {renderPagination(pageKey, currentHistory.length)}
          </>
        )}
      </div>
    </div>
    )
  }

  const renderComprasSection = () => {
    const products = panelData?.products || []

    return (
      <div className={styles.sectionStack}>
        <div className={styles.blockCard}>
          <div className={styles.blockHeader}>
            <div>
              <span className={styles.blockEyebrow}>Compras</span>
              <h3>Planes disponibles</h3>
            </div>
          </div>

          {products.length === 0 ? (
            <div className={styles.emptyCard}>Aun no hay planes disponibles para comprar.</div>
          ) : (
            <div className={styles.productGrid}>
              {products.map(product => (
                <article key={product.id} className={styles.productCard}>
                  {product.imageDataUrl ? (
                    <img className={styles.productImage} src={product.imageDataUrl} alt={product.title} />
                  ) : (
                    <div className={styles.productPlaceholder}>Sin imagen</div>
                  )}
                  <div className={styles.productBody}>
                    <div className={styles.productHead}>
                      <strong>{product.title}</strong>
                      {renderStatusBadge(product.inStock ? 'activa' : 'desactivada')}
                    </div>
                    <span>Proveedor: {product.providerName}</span>
                    <span>Precio: {formatMoney(product.effectivePrice)}</span>
                    <button
                      type='button'
                      className={styles.primaryButton}
                      onClick={() => setBuyProduct(product)}
                      disabled={!product.inStock}
                    >
                      Comprar
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      </div>
    )
  }

  const renderCodigosSection = () => (
    <div className={styles.sectionStack}>
      <div className={styles.blockCard}>
        <div className={styles.blockHeader}>
          <div>
            <span className={styles.blockEyebrow}>Codigos</span>
            <h3>Correos asignados y validos</h3>
          </div>
        </div>
        <div className={styles.codesWrap}>
          <CodigosWorkspace embedded />
        </div>
      </div>
    </div>
  )

  const renderOwnerUsersSection = () => {
    const users = panelData?.allUsers || []

    return (
      <div className={styles.sectionStack}>
        <div className={styles.blockCard}>
          <div className={styles.blockHeader}>
            <div>
              <span className={styles.blockEyebrow}>Usuarios</span>
              <h3>Todos los clientes</h3>
            </div>
          </div>

          {users.length === 0 ? (
            <div className={styles.emptyCard}>Todavia no hay usuarios registrados.</div>
          ) : (
            <div className={styles.userList}>
              {users.map(user => (
                <article key={user.id} className={styles.userCard}>
                  <div className={styles.userHead}>
                    <div>
                      <strong>{user.username}</strong>
                      <span>Registro: {formatDate(user.createdAt)}</span>
                    </div>
                    <div className={styles.userHeadMeta}>
                      {renderStatusBadge(user.role)}
                      <span>{user.activeAccounts} cuentas activas</span>
                    </div>
                  </div>

                  <button
                    type='button'
                    className={styles.secondaryButton}
                    onClick={() => setExpandedUserId(current => (current === user.id ? null : user.id))}
                  >
                    {expandedUserId === user.id ? 'Ocultar cuentas' : 'Ver cuentas'}
                  </button>

                  {expandedUserId === user.id && (
                    <div className={styles.subList}>
                      {user.accounts.length === 0 ? (
                        <div className={styles.emptyCard}>Este usuario no tiene cuentas asignadas.</div>
                      ) : (
                        user.accounts.map(account => (
                          <div key={account.id} className={styles.subCard}>
                            <div>
                              <strong>{account.serviceName}</strong>
                              <span>{account.accountEmail}</span>
                              <span>
                                {formatDate(account.cutoffDate)} · {account.daysRemaining ?? '-'} dias
                              </span>
                            </div>
                            <div className={styles.inlineActions}>
                              {renderStatusBadge(account.status)}
                              {account.ownerId === profile?.id && (
                                <button
                                  type='button'
                                  className={styles.ghostButton}
                                  onClick={() => setRemoveConfirmAccount(account)}
                                >
                                  Quitar cuenta
                                </button>
                              )}
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </article>
              ))}
            </div>
          )}
        </div>
      </div>
    )
  }

  const renderOwnerUsersSectionV2 = () => {
    const usersPageKey = 'owner-users'
    const accountsPageKey = `owner-accounts-${expandedUserId}-${ownerAccountFilter}`
    const pageOwnerUsers = getPageItems(usersPageKey, ownerUsers)
    const pageOwnerAccounts = getPageItems(accountsPageKey, filteredOwnerAccounts)

    return (
    <div className={styles.sectionStack}>
      <div className={styles.ownerUsersLayout}>
        <div className={styles.blockCard}>
          <div className={styles.blockHeader}>
            <div>
              <span className={styles.blockEyebrow}>Usuarios</span>
              <h3>Clientes y usuarios</h3>
            </div>
            <button type='button' className={styles.primaryButton} onClick={() => setPendingUserOpen(true)}>
              Crear usuario
            </button>
          </div>

          <div className={styles.ownerUserRail}>
            <input
              className={styles.input}
              placeholder='Buscar usuario'
              value={ownerUserSearch}
              onChange={event => setOwnerUserSearch(event.target.value)}
            />

            <div className={styles.ownerUserList}>
              <button
                type='button'
                className={expandedUserId === 'all' ? styles.ownerUserOptionActive : styles.ownerUserOption}
                onClick={() => setExpandedUserId('all')}
              >
                <div className={styles.ownerUserMain}>
                  <strong>Todos</strong>
                </div>
                <strong className={styles.ownerUserCount}>({ownerAllAccounts.length})</strong>
              </button>

              {ownerUsers.length === 0 ? (
                <div className={styles.emptyCard}>No hay usuarios que coincidan con la busqueda.</div>
              ) : (
                pageOwnerUsers.map(user => (
                  <button
                    key={user.id}
                    type='button'
                    className={
                      expandedUserId === user.id ? styles.ownerUserOptionActive : styles.ownerUserOption
                    }
                    onClick={() => setExpandedUserId(user.id)}
                  >
                    <div className={styles.ownerUserMain}>
                      <strong>{user.username}</strong>
                    </div>
                    <strong className={styles.ownerUserCount}>({user.accounts.length})</strong>
                  </button>
                ))
              )}
              {renderPagination(usersPageKey, ownerUsers.length)}
            </div>
          </div>
        </div>

        <div className={styles.blockCard}>
          <div className={styles.ownerPanelHeader}>
            <div>
              <span className={styles.blockEyebrow}>
                {expandedUserId === 'all' ? 'General' : 'Cliente'}
              </span>
              <h3>
                {expandedUserId === 'all'
                  ? 'Todas tus cuentas asignadas'
                  : `Cuentas de ${selectedOwnerUser?.username || 'cliente'}`}
              </h3>
            </div>
            <div className={styles.inlineTabs}>
              <button
                type='button'
                className={ownerAccountFilter === 'todos' ? styles.tabActive : styles.tabButton}
                onClick={() => setOwnerAccountFilter('todos')}
              >
                Todos
              </button>
              <button
                type='button'
                className={ownerAccountFilter === 'vigentes' ? styles.tabActive : styles.tabButton}
                onClick={() => setOwnerAccountFilter('vigentes')}
              >
                Vigentes
              </button>
              <button
                type='button'
                className={ownerAccountFilter === 'por_vencer' ? styles.tabActive : styles.tabButton}
                onClick={() => setOwnerAccountFilter('por_vencer')}
              >
                7 dias o menos
              </button>
              <button
                type='button'
                className={ownerAccountFilter === 'vencidas' ? styles.tabActive : styles.tabButton}
                onClick={() => setOwnerAccountFilter('vencidas')}
              >
                Vencidas
              </button>
            </div>
          </div>

          <div className={styles.ownerAccountTools}>
            <input
              className={styles.input}
              placeholder='Buscar por correo, cliente o servicio'
              value={ownerAccountSearch}
              onChange={event => setOwnerAccountSearch(event.target.value)}
            />
            <button type='button' className={styles.secondaryButton} onClick={() => void exportOwnerAccounts()}>
              Exportar Excel
            </button>
          </div>

          {filteredOwnerAccounts.length === 0 ? (
            <div className={styles.emptyCard}>No hay cuentas para ese filtro.</div>
          ) : (
            <>
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Servicio</th>
                      <th>Correo</th>
                      <th>Cliente</th>
                      <th>Propietario</th>
                      <th>Corte</th>
                      <th>Dias</th>
                      <th>Estado</th>
                      <th>Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pageOwnerAccounts.map(account => (
                      <tr key={account.id}>
                        <td>{account.serviceName}</td>
                        <td>{account.accountEmail}</td>
                        <td>{account.clientUsername}</td>
                        <td>{account.ownerUsername}</td>
                        <td>{formatDate(account.cutoffDate)}</td>
                        <td>{renderDaysBadge(account.daysRemaining)}</td>
                        <td>{renderStatusBadge(account.status)}</td>
                        <td>
                          <div className={styles.inlineActions}>
                            <button
                              type='button'
                              className={styles.iconActionButton}
                              title='Editar cuenta'
                              onClick={() => openEditAccount(account)}
                            >
                              ✏️
                            </button>
                            <button
                              type='button'
                              className={styles.iconDangerButton}
                              title='Quitar cuenta'
                              onClick={() => setRemoveConfirmAccount(account)}
                            >
                              🗑️
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className={styles.cardGrid}>
                {pageOwnerAccounts.map(account => (
                  <article key={`${account.id}-owner-card`} className={styles.miniCard}>
                    <div className={styles.miniCardHead}>
                      <strong>{account.serviceName}</strong>
                      {renderStatusBadge(account.status)}
                    </div>
                    <div className={styles.ownerAccountInfo}>
                      <span>{account.accountEmail}</span>
                      <span>Cliente: {account.clientUsername}</span>
                      <span>Propietario: {account.ownerUsername}</span>
                      <div className={styles.accountMetaRow}>
                        <span>Corte: {formatDate(account.cutoffDate)}</span>
                        {renderDaysBadge(account.daysRemaining)}
                      </div>
                    </div>
                    <div className={styles.inlineActions}>
                      <button
                        type='button'
                        className={styles.iconActionButton}
                        title='Editar cuenta'
                        onClick={() => openEditAccount(account)}
                      >
                        ✏️
                      </button>
                      <button
                        type='button'
                        className={styles.iconDangerButton}
                        title='Quitar cuenta'
                        onClick={() => setRemoveConfirmAccount(account)}
                      >
                        🗑️
                      </button>
                    </div>
                  </article>
                ))}
              </div>
              {renderPagination(accountsPageKey, filteredOwnerAccounts.length)}
            </>
          )}
        </div>
      </div>
    </div>
    )
  }

  const renderAssignSection = () => (
    <div className={styles.sectionStack}>
      <div className={styles.blockCard}>
        <div className={styles.blockHeader}>
          <div>
            <span className={styles.blockEyebrow}>Asignacion</span>
            <h3>Agregar cuentas a usuarios</h3>
          </div>
          <button type='button' className={styles.primaryButton} onClick={() => setAssignOpen(true)}>
            Agregar cuenta
          </button>
        </div>

        <div className={styles.emptyCard}>
          Usa el modal para buscar usuarios, asignar uno o varios correos y dejar su renovacion lista.
        </div>
      </div>
    </div>
  )

  const renderVentasSection = () => (
    <div className={styles.sectionStack}>
      <div className={styles.blockCard}>
        <div className={styles.blockHeader}>
          <div>
            <span className={styles.blockEyebrow}>Ventas</span>
            <h3>Productos y compras</h3>
          </div>
          <button type='button' className={styles.primaryButton} onClick={() => setProductOpen(true)}>
            Agregar producto
          </button>
        </div>

        <div className={styles.productGrid}>
          {ownerProducts.length === 0 ? (
            <div className={styles.emptyCard}>Todavia no has creado productos.</div>
          ) : (
            ownerProducts.map(product => (
              <article key={product.id} className={styles.productCard}>
                {product.imageDataUrl ? (
                  <img className={styles.productImage} src={product.imageDataUrl} alt={product.title} />
                ) : (
                  <div className={styles.productPlaceholder}>Sin imagen</div>
                )}
                <div className={styles.productBody}>
                  <div className={styles.productHead}>
                    <strong>{product.title}</strong>
                    {renderStatusBadge(product.inStock ? 'activa' : 'desactivada')}
                  </div>
                  <span>Proveedor: {product.providerName}</span>
                  <span>Base: {formatMoney(product.price)}</span>
                  {product.specialPrices.length > 0 && (
                    <span>{product.specialPrices.length} precios especiales</span>
                  )}
                  <button
                    type='button'
                    className={styles.secondaryButton}
                    onClick={() => void toggleStock(product.id)}
                  >
                    {product.inStock ? 'Poner sin stock' : 'Poner con stock'}
                  </button>
                </div>
              </article>
            ))
          )}
        </div>
      </div>

      <div className={styles.blockCard}>
        <div className={styles.blockHeader}>
          <div>
            <span className={styles.blockEyebrow}>Historial</span>
            <h3>Ventas registradas</h3>
          </div>
        </div>

        {ownerSales.length === 0 ? (
          <div className={styles.emptyCard}>Todavia no hay ventas registradas.</div>
        ) : (
          <div className={styles.saleList}>
            {ownerSales.map(sale => (
              <article key={sale.id} className={styles.saleCard}>
                <div>
                  <strong>{sale.titleSnapshot}</strong>
                  <span>
                    {sale.buyerUsername} · {sale.providerNameSnapshot}
                  </span>
                  <span>{formatMoney(sale.pricePaid)}</span>
                  <span>{formatDateTime(sale.createdAt)}</span>
                </div>
                <div className={styles.saleActions}>
                  {renderStatusBadge(sale.status)}
                  {sale.paymentProofDataUrl && (
                    <a
                      href={sale.paymentProofDataUrl}
                      target='_blank'
                      rel='noreferrer noopener'
                      className={styles.linkButton}
                    >
                      Ver comprobante
                    </a>
                  )}
                  <div className={styles.inlineActions}>
                    <button
                      type='button'
                      className={styles.secondaryButton}
                      onClick={() => void updateSaleStatus(sale.id, 'pagada')}
                    >
                      Marcar pagada
                    </button>
                    <button
                      type='button'
                      className={styles.ghostButton}
                      onClick={() => void updateSaleStatus(sale.id, 'cancelada')}
                    >
                      Cancelar
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </div>
  )

  const renderSupportSectionV2 = (ownerMode: boolean) => {
    const pageKey = ownerMode ? 'owner-requests' : 'user-requests'
    const pageRequests = getPageItems(pageKey, currentRequests)
    const requestPage = getCurrentPage(pageKey, currentRequests.length)

    return (
    <div className={styles.sectionSplit}>
      <div className={styles.blockCard}>
        <div className={styles.blockHeader}>
          <div>
            <span className={styles.blockEyebrow}>{ownerMode ? 'Solicitudes' : 'Soporte'}</span>
            <h3>{ownerMode ? `Chats y renovaciones (${currentRequests.length})` : 'Tus solicitudes activas'}</h3>
          </div>
        </div>

        {currentRequests.length === 0 ? (
          <div className={styles.emptyCard}>Todavia no hay solicitudes en esta vista.</div>
        ) : (
          <div className={styles.requestList}>
            {pageRequests.map((request, index) => (
              <button
                key={request.id}
                type='button'
                className={request.id === selectedRequest?.id ? styles.requestItemActive : styles.requestItem}
                onClick={() => setSelectedRequestId(request.id)}
              >
                <span className={styles.requestNumber}>{(requestPage - 1) * PAGE_SIZE + index + 1}</span>
                <div className={styles.requestCardBody}>
                  <strong>{request.subject}</strong>
                  <span>{request.serviceName || 'Sin cuenta'}</span>
                  <span>{request.accountEmail || 'Sin correo'}</span>
                </div>
                <div className={styles.requestCardSide}>
                  {renderStatusBadge(request.status)}
                  <span className={styles.requestDate}>{formatDateTime(request.createdAt)}</span>
                </div>
              </button>
            ))}
            {renderPagination(pageKey, currentRequests.length)}
          </div>
        )}
      </div>

      <div className={styles.blockCard}>
        {selectedRequest ? (
          <>
            <div className={styles.ownerPanelHeader}>
              <div>
                <span className={styles.blockEyebrow}>{selectedRequest.requestKind}</span>
                <h3>{selectedRequest.subject}</h3>
              </div>
              {renderStatusBadge(selectedRequest.status)}
            </div>

            <div className={styles.supportDetailsGrid}>
              <div className={styles.previewTone}>
                <span className={styles.blockEyebrow}>Cuenta</span>
                <strong>{selectedRequest.accountEmail || 'Sin cuenta vinculada'}</strong>
              </div>
              <div className={styles.previewTone}>
                <span className={styles.blockEyebrow}>{ownerMode ? 'Cliente' : 'Proveedor'}</span>
                <strong>{ownerMode ? selectedRequest.requesterUsername : selectedRequest.ownerUsername}</strong>
              </div>
              {selectedRequest.renewalPrice !== null && (
                <div className={styles.previewTone}>
                  <span className={styles.blockEyebrow}>Renovacion</span>
                  <strong>{formatMoney(selectedRequest.renewalPrice)}</strong>
                </div>
              )}
            </div>

            {selectedRequest.description && (
              <div className={styles.descriptionBox}>{selectedRequest.description}</div>
            )}

            {selectedRequest.paymentProofDataUrl && (
              <img
                className={styles.proofImage}
                src={selectedRequest.paymentProofDataUrl}
                alt='Comprobante enviado'
              />
            )}

            {ownerMode && selectedRequest.accountId && (
              <div className={styles.replaceCard}>
                <div>
                  <span className={styles.blockEyebrow}>Reemplazar correo</span>
                  <strong>Actualiza esta cuenta y avisa al cliente</strong>
                </div>
                <div className={styles.replaceActions}>
                  <input
                    className={styles.input}
                    placeholder='Nuevo correo de la cuenta'
                    value={replacementEmail}
                    onChange={event => setReplacementEmail(event.target.value)}
                  />
                  <button
                    type='button'
                    className={styles.primaryButton}
                    onClick={() => void replaceSupportAccountEmail(selectedRequest)}
                    disabled={saving}
                  >
                    Reemplazar
                  </button>
                </div>
              </div>
            )}

            <div className={styles.chatHeader}>
              <div>
                <span className={styles.blockEyebrow}>Conversacion</span>
                <strong>Chat en vivo</strong>
              </div>
              <span className={styles.badgeMuted}>{(selectedRequest.messages || []).length} mensajes</span>
            </div>

            <div className={styles.chatBox}>
              {(selectedRequest.messages || []).length === 0 ? (
                <div className={styles.emptyChat}>Aun no hay mensajes en este chat.</div>
              ) : (
                selectedRequest.messages.map(message => (
                  <article
                    key={message.id}
                    className={
                      message.senderId === profile?.id ? styles.messageMine : styles.messageOther
                    }
                  >
                    <div className={styles.messageMeta}>
                      <strong>{message.senderUsername}</strong>
                      <span>{formatDateTime(message.createdAt)}</span>
                    </div>
                    <p>{message.body}</p>
                    {message.imageDataUrl && (
                      <img className={styles.messageImage} src={message.imageDataUrl} alt='Adjunto del chat' />
                    )}
                  </article>
                ))
              )}
            </div>

            <div className={styles.composerCard}>
              <label className={styles.fieldLabel}>
                <span>Mensaje para el chat</span>
                <textarea
                  className={styles.textarea}
                  placeholder='Escribe tu respuesta o detalle adicional.'
                  value={messageForm.body}
                  onChange={event => setMessageForm(current => ({ ...current, body: event.target.value }))}
                />
              </label>
              <div className={styles.composerActions}>
                <label className={styles.fieldLabel}>
                  <span>Imagen opcional</span>
                  <span className={styles.fileButton}>
                    Adjuntar imagen
                    <input
                      type='file'
                      accept='image/*'
                      onChange={event =>
                        void handleFileChange(event, value =>
                          setMessageForm(current => ({ ...current, imageDataUrl: value }))
                        )
                      }
                    />
                  </span>
                </label>
                <button
                  type='button'
                  className={styles.primaryButton}
                  onClick={() => void submitChatMessage()}
                  disabled={saving}
                >
                  Enviar
                </button>
              </div>
            </div>

            {ownerMode && (
              <div className={styles.inlineActions}>
                <button
                  type='button'
                  className={styles.ghostButton}
                  onClick={() => void closeRequestFlow(selectedRequest.id, 'request_close')}
                  disabled={saving}
                >
                  Cerrar ticket
                </button>
              </div>
            )}
            {!ownerMode && selectedRequest.status === 'cierre_solicitado' && (
              <div className={styles.inlineActions}>
                <button
                  type='button'
                  className={styles.primaryButton}
                  onClick={() => void closeRequestFlow(selectedRequest.id, 'confirm_close')}
                  disabled={saving}
                >
                  Si todo conforme
                </button>
              </div>
            )}
          </>
        ) : (
          <div className={styles.emptyCard}>Selecciona una solicitud para ver el chat y sus acciones.</div>
        )}
      </div>
    </div>
    )
  }

  const renderComprasSectionV2 = () => {
    const products = panelData?.products || []
    const pageKey = 'user-products'
    const pageProducts = getPageItems(pageKey, products)

    return (
      <div className={styles.sectionStack}>
        <div className={styles.blockCard}>
          <div className={styles.blockHeader}>
            <div>
              <span className={styles.blockEyebrow}>Compras</span>
              <h3>Planes disponibles</h3>
            </div>
          </div>

          {products.length === 0 ? (
            <div className={styles.emptyCard}>Aun no hay planes disponibles para comprar.</div>
          ) : (
            <>
              <div className={styles.productGrid}>
                {pageProducts.map(product => (
                  <article key={product.id} className={styles.productCard}>
                    {product.imageDataUrl ? (
                      <img className={styles.productImage} src={product.imageDataUrl} alt={product.title} />
                    ) : (
                      <div className={styles.productPlaceholder}>Sin imagen</div>
                    )}
                    <div className={styles.productBody}>
                      <div className={styles.productBadgeRow}>
                        {renderProductStockBadge(product.inStock)}
                      </div>
                      <div className={styles.productHead}>
                        <strong>{product.title}</strong>
                      </div>
                      <div className={styles.productMetaList}>
                        <span className={styles.productProviderLabel}>Proveedor</span>
                        <span className={styles.productOwnerLine}>{product.providerName}</span>
                        <div className={styles.productPriceRow}>
                          <span className={styles.productPricePill}>{formatMoney(product.effectivePrice)}</span>
                        </div>
                      </div>
                      <button
                        type='button'
                        className={styles.productActionButton}
                        onClick={() => setBuyProduct(product)}
                        disabled={!product.inStock}
                      >
                        Comprar
                      </button>
                    </div>
                  </article>
                ))}
              </div>
              {renderPagination(pageKey, products.length)}
            </>
          )}
        </div>
      </div>
    )
  }

  const renderVentasSectionV2 = () => {
    const productPageKey = 'owner-products'
    const salePageKey = 'owner-sales'
    const pageOwnerProducts = getPageItems(productPageKey, ownerProducts)
    const pageOwnerSales = getPageItems(salePageKey, ownerSales)

    return (
    <div className={styles.sectionStack}>
      <div className={styles.blockCard}>
        <div className={styles.blockHeader}>
          <div>
            <span className={styles.blockEyebrow}>Ventas</span>
            <h3>Productos y compras</h3>
          </div>
          <button type='button' className={styles.primaryButton} onClick={() => setProductOpen(true)}>
            Agregar producto
          </button>
        </div>

        <div className={styles.productGrid}>
          {ownerProducts.length === 0 ? (
            <div className={styles.emptyCard}>Todavia no has creado productos.</div>
          ) : (
            pageOwnerProducts.map(product => (
                <article key={product.id} className={styles.productCard}>
                  {product.imageDataUrl ? (
                    <img className={styles.productImage} src={product.imageDataUrl} alt={product.title} />
                  ) : (
                    <div className={styles.productPlaceholder}>Sin imagen</div>
                  )}
                  <div className={styles.productBody}>
                    <div className={styles.productBadgeRow}>
                      {renderProductStockBadge(product.inStock)}
                    </div>
                    <div className={styles.productHead}>
                      <strong>{product.title}</strong>
                    </div>
                    <div className={styles.productMetaList}>
                      <span className={styles.productProviderLabel}>Proveedor</span>
                      <span className={styles.productOwnerLine}>{product.providerName}</span>
                      <div className={styles.productPriceRow}>
                        <span className={styles.productPricePill}>{formatMoney(product.price)}</span>
                        {product.specialPrices.length > 0 && (
                          <span className={styles.badgeMuted}>{product.specialPrices.length} especiales</span>
                        )}
                      </div>
                    </div>
                    <div className={styles.productOwnerActions}>
                      <button
                        type='button'
                        className={styles.productActionButtonAlt}
                        onClick={() => void toggleStock(product.id)}
                      >
                        {product.inStock ? 'Poner sin stock' : 'Poner con stock'}
                      </button>
                      <button
                        type='button'
                        className={styles.productDeleteButton}
                        onClick={() => void deleteProduct(product)}
                      >
                        Borrar producto
                      </button>
                    </div>
                  </div>
                </article>
            ))
          )}
        </div>
        {renderPagination(productPageKey, ownerProducts.length)}
      </div>

      <div className={styles.blockCard}>
        <div className={styles.blockHeader}>
          <div>
            <span className={styles.blockEyebrow}>Historial</span>
            <h3>Ventas registradas</h3>
          </div>
        </div>

        {ownerSales.length === 0 ? (
          <div className={styles.emptyCard}>Todavia no hay ventas registradas.</div>
        ) : (
          <div className={styles.saleList}>
            {pageOwnerSales.map(sale => (
              <article key={sale.id} className={styles.saleCard}>
                <div className={styles.ownerAccountInfo}>
                  <strong>{sale.titleSnapshot}</strong>
                  <span>{sale.buyerUsername}</span>
                  <span>{sale.providerNameSnapshot}</span>
                  <div className={styles.productPriceRow}>
                    <span className={styles.productPricePill}>{formatMoney(sale.pricePaid)}</span>
                    <span>{formatDateTime(sale.createdAt)}</span>
                  </div>
                </div>
                <div className={styles.saleActions}>
                  {renderStatusBadge(sale.status)}
                  {sale.paymentProofDataUrl && (
                    <a
                      href={sale.paymentProofDataUrl}
                      target='_blank'
                      rel='noreferrer noopener'
                      className={styles.linkButton}
                    >
                      Ver comprobante
                    </a>
                  )}
                  <div className={styles.inlineActions}>
                    <button
                      type='button'
                      className={styles.secondaryButton}
                      onClick={() => void updateSaleStatus(sale.id, 'pagada')}
                    >
                      Marcar pagada
                    </button>
                    <button
                      type='button'
                      className={styles.ghostButton}
                      onClick={() => void updateSaleStatus(sale.id, 'cancelada')}
                    >
                      Cancelar
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
        {renderPagination(salePageKey, ownerSales.length)}
      </div>
    </div>
    )
  }

  const renderTelegramSection = () => {
    const pageKey = 'owner-telegram'
    const pageTelegramAccounts = getPageItems(pageKey, telegramAccounts)

    return (
      <div className={styles.sectionStack}>
        <div className={styles.blockCard}>
          <div className={styles.blockHeader}>
            <div>
              <span className={styles.blockEyebrow}>Telegram</span>
              <h3>Cuentas con flujo especial</h3>
            </div>
          </div>

          <div className={styles.settingsGrid}>
            <div className={styles.settingsCard}>
              <div>
                <span className={styles.blockEyebrow}>Nueva cuenta</span>
                <h4>Activar Telegram en Codigos</h4>
              </div>
              <label className={styles.formStack}>
                <span>Correo</span>
                <input
                  className={styles.input}
                  type='email'
                  placeholder='correo@dominio.com'
                  value={telegramForm.accountEmail}
                  onChange={event =>
                    setTelegramForm(current => ({ ...current, accountEmail: event.target.value }))
                  }
                />
              </label>
              <label className={styles.formStack}>
                <span>Servicio</span>
                <input
                  className={styles.input}
                  placeholder='Netflix'
                  value={telegramForm.serviceName}
                  onChange={event =>
                    setTelegramForm(current => ({ ...current, serviceName: event.target.value }))
                  }
                />
              </label>
              <button
                type='button'
                className={styles.primaryButton}
                onClick={() => void submitTelegramAccount()}
                disabled={saving}
              >
                Guardar cuenta
              </button>
            </div>

            <div className={styles.settingsCard}>
              <div>
                <span className={styles.blockEyebrow}>Conexion</span>
                <h4>Bridge Telegram</h4>
              </div>
              <p>
                Estas cuentas activan los botones especiales dentro de Codigos. La conexion real usa
                <strong> CODES_TELEGRAM_BRIDGE_URL</strong> y <strong>CODES_TELEGRAM_BRIDGE_SECRET</strong>.
              </p>
              <div className={styles.emptyCard}>
                Si el bridge esta prendido, el usuario escribe el correo asignado y aparece el flujo Telegram.
              </div>
            </div>
          </div>
        </div>

        <div className={styles.blockCard}>
          <div className={styles.blockHeader}>
            <div>
              <span className={styles.blockEyebrow}>Registradas</span>
              <h3>Cuentas Telegram</h3>
            </div>
            <button
              type='button'
              className={styles.secondaryButton}
              onClick={() => void fetchTelegramAccounts()}
              disabled={telegramLoading}
            >
              {telegramLoading ? 'Actualizando...' : 'Actualizar'}
            </button>
          </div>

          {telegramAccounts.length === 0 ? (
            <div className={styles.emptyCard}>Todavia no tienes cuentas Telegram configuradas.</div>
          ) : (
            <>
              <div className={styles.cardGridVisible}>
                {pageTelegramAccounts.map(account => (
                  <article key={account.id} className={styles.miniCard}>
                    <div className={styles.miniCardHead}>
                      <strong>{account.serviceName}</strong>
                      {renderProductStockBadge(account.enabled)}
                    </div>
                    <p>{account.accountEmail}</p>
                    <span>Creada: {formatDate(account.createdAt)}</span>
                    <div className={styles.inlineActions}>
                      <button
                        type='button'
                        className={styles.secondaryButton}
                        onClick={() => void toggleTelegramAccount(account)}
                        disabled={saving}
                      >
                        {account.enabled ? 'Desactivar' : 'Activar'}
                      </button>
                      <button
                        type='button'
                        className={styles.ghostButton}
                        onClick={() => void deleteTelegramAccount(account)}
                        disabled={saving}
                      >
                        Borrar
                      </button>
                    </div>
                  </article>
                ))}
              </div>
              {renderPagination(pageKey, telegramAccounts.length)}
            </>
          )}
        </div>
      </div>
    )
  }

  const renderConfiguracionSection = () => (
    <div className={styles.sectionStack}>
      <div className={styles.blockCard}>
        <div className={styles.blockHeader}>
          <div>
            <span className={styles.blockEyebrow}>Seguridad</span>
            <h3>Configura tu acceso</h3>
          </div>
        </div>

        <div className={styles.settingsGrid}>
          <form
            className={styles.settingsCard}
            onSubmit={event => {
              event.preventDefault()
              void updatePasswordSettings()
            }}
          >
            <div>
              <span className={styles.blockEyebrow}>Contrasena</span>
              <h4>Cambiar contrasena</h4>
            </div>

            <label className={styles.formStack}>
              <span>Contrasena actual</span>
              <input
                className={styles.input}
                type='password'
                autoComplete='current-password'
                value={settingsForm.currentPassword}
                onChange={event => updateSettingsField('currentPassword', event.target.value)}
              />
            </label>

            <div className={styles.formGrid}>
              <label className={styles.formStack}>
                <span>Nueva contrasena</span>
                <input
                  className={styles.input}
                  type='password'
                  autoComplete='new-password'
                  value={settingsForm.nextPassword}
                  onChange={event => updateSettingsField('nextPassword', event.target.value)}
                />
              </label>
              <label className={styles.formStack}>
                <span>Confirmar nueva contrasena</span>
                <input
                  className={styles.input}
                  type='password'
                  autoComplete='new-password'
                  value={settingsForm.nextPasswordConfirm}
                  onChange={event => updateSettingsField('nextPasswordConfirm', event.target.value)}
                />
              </label>
            </div>

            <button type='submit' className={styles.primaryButton} disabled={saving}>
              Guardar contrasena
            </button>
          </form>

          <form
            className={styles.settingsCard}
            onSubmit={event => {
              event.preventDefault()
              void updatePinSettings()
            }}
          >
            <div>
              <span className={styles.blockEyebrow}>Codigo</span>
              <h4>Cambiar codigo de 4 digitos</h4>
            </div>

            <label className={styles.formStack}>
              <span>Codigo antiguo</span>
              <input
                className={styles.input}
                type='password'
                inputMode='numeric'
                maxLength={4}
                autoComplete='one-time-code'
                value={settingsForm.currentPin}
                onChange={event => updateSettingsField('currentPin', event.target.value)}
              />
            </label>

            <div className={styles.formGrid}>
              <label className={styles.formStack}>
                <span>Codigo nuevo</span>
                <input
                  className={styles.input}
                  type='password'
                  inputMode='numeric'
                  maxLength={4}
                  autoComplete='one-time-code'
                  value={settingsForm.nextPin}
                  onChange={event => updateSettingsField('nextPin', event.target.value)}
                />
              </label>
              <label className={styles.formStack}>
                <span>Confirmar codigo nuevo</span>
                <input
                  className={styles.input}
                  type='password'
                  inputMode='numeric'
                  maxLength={4}
                  autoComplete='one-time-code'
                  value={settingsForm.nextPinConfirm}
                  onChange={event => updateSettingsField('nextPinConfirm', event.target.value)}
                />
              </label>
            </div>

            <button type='submit' className={styles.primaryButton} disabled={saving}>
              Guardar codigo
            </button>
          </form>
        </div>
      </div>
    </div>
  )

  const renderCurrentSection = () => {
    if (panelView === 'owner') {
      if (activeSection === 'vip') return renderOwnerUsersSectionV2()
      if (activeSection === 'solicitudes') return renderSupportSectionV2(true)
      if (activeSection === 'asignacion') return renderAssignSection()
      if (activeSection === 'ventas') return renderVentasSectionV2()
      if (activeSection === 'telegram') return renderTelegramSection()
      if (activeSection === 'codigos') return renderCodigosSection()
      if (activeSection === 'historial') return renderHistorialSection(true)
      if (activeSection === 'configuracion') return renderConfiguracionSection()
      return renderSupportSectionV2(true)
    }

    if (activeSection === 'cuentas') return renderAccountsSection()
    if (activeSection === 'soporte') return renderSupportSectionV2(false)
    if (activeSection === 'gestion') return renderGestionSection()
    if (activeSection === 'compras') return renderComprasSectionV2()
    if (activeSection === 'codigos') return renderCodigosSection()
    if (activeSection === 'historial') return renderHistorialSection(false)
    if (activeSection === 'configuracion') return renderConfiguracionSection()
    return renderAccountsSection()
  }

  if (loading && !panelData) {
    return (
      <main className={styles.page}>
        <section className={styles.loadingCard}>Cargando panel...</section>
      </main>
    )
  }

  return (
    <main className={styles.page}>
      <div className={styles.pageGlowA} aria-hidden='true' />
      <div className={styles.pageGlowB} aria-hidden='true' />

      <section className={styles.shell}>
        <aside className={styles.sidebar}>
          <div className={styles.sidebarTop}>
            <div className={styles.sidebarBrand}>
              <span>{profile?.username || 'Panel'}</span>
            </div>
            <div className={styles.desktopControls}>
              {renderSectionButtons(styles.navList)}
            </div>
          </div>

          <button type='button' className={styles.exitButton} onClick={() => void handleSignOut()}>
            Cerrar sesion
          </button>
        </aside>

        <section className={styles.content}>
          <div className={styles.contentHeader}>
            <div className={styles.heroCard}>
              <h2>{currentSection.label}</h2>
            </div>
          </div>

          {notice && <div className={styles.noticeBanner}>{notice}</div>}
          {error && <div className={styles.errorBanner}>{error}</div>}

          {renderCurrentSection()}
        </section>
      </section>

      <div className={styles.mobileDock}>
        <div className={styles.mobileUtilityRow}>
          <button type='button' className={styles.mobileExitButton} onClick={() => void handleSignOut()}>
            <span className={styles.mobileExitIcon} aria-hidden='true'>
              <svg viewBox='0 0 24 24'>
                <path d='M10 7.5V5h8v14h-8v-2.5' />
                <path d='M14 12H5' />
                <path d='m8.5 8.5-3.5 3.5 3.5 3.5' />
              </svg>
            </span>
            <span>Salir</span>
          </button>
        </div>
        {renderSectionButtons(styles.mobileNavList)}
      </div>

      {removeConfirmAccount && (
        <div className={styles.modalOverlay}>
          <div className={styles.modalCard}>
            <div className={styles.modalHeader}>
              <div>
                <span className={styles.blockEyebrow}>Confirmacion</span>
                <h3>Quitar cuenta</h3>
              </div>
              <button type='button' className={styles.modalClose} onClick={() => setRemoveConfirmAccount(null)}>
                Cerrar
              </button>
            </div>
            <div className={styles.formStack}>
              <div className={styles.confirmBox}>
                <strong>{removeConfirmAccount.accountEmail}</strong>
                <span>
                  Se quitara esta cuenta del usuario seleccionado y tambien de sus subclientes vinculados.
                </span>
              </div>
              <div className={styles.modalActions}>
                <button type='button' className={styles.secondaryButton} onClick={() => setRemoveConfirmAccount(null)}>
                  Cancelar
                </button>
                <button
                  type='button'
                  className={styles.dangerButton}
                  onClick={() => void removeAccount(removeConfirmAccount.id)}
                  disabled={saving}
                >
                  Si, quitar cuenta
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {supportChoiceAccount && (
        <div className={styles.modalOverlay}>
          <div className={styles.modalCard}>
            <div className={styles.modalHeader}>
              <div>
                <span className={styles.blockEyebrow}>Soporte</span>
                <h3>{supportChoiceAccount.accountEmail}</h3>
              </div>
              <button type='button' className={styles.modalClose} onClick={() => setSupportChoiceAccount(null)}>
                Cerrar
              </button>
            </div>
            <div className={styles.modalActions}>
              <button
                type='button'
                className={styles.primaryButton}
                onClick={() => void submitNoPayment(supportChoiceAccount)}
                disabled={saving}
              >
                La cuenta esta sin pago
              </button>
              <button
                type='button'
                className={styles.secondaryButton}
                onClick={() => {
                  setIssueAccount(supportChoiceAccount)
                  setSupportChoiceAccount(null)
                }}
              >
                Otro problema
              </button>
            </div>
          </div>
        </div>
      )}

      {issueAccount && (
        <div className={styles.modalOverlay}>
          <div className={styles.modalCard}>
            <div className={styles.modalHeader}>
              <div>
                <span className={styles.blockEyebrow}>Otro problema</span>
                <h3>{issueAccount.accountEmail}</h3>
              </div>
              <button type='button' className={styles.modalClose} onClick={() => setIssueAccount(null)}>
                Cerrar
              </button>
            </div>
            <div className={styles.formStack}>
              <label className={styles.fieldLabel}>
                <span>Asunto del problema</span>
                <input
                  className={styles.input}
                  placeholder='Ejemplo: no ingresa la contrasena'
                  value={issueForm.subject}
                  onChange={event => setIssueForm(current => ({ ...current, subject: event.target.value }))}
                />
              </label>
              <label className={styles.fieldLabel}>
                <span>Descripcion para soporte</span>
                <textarea
                  className={styles.textarea}
                  placeholder='Explica que pasa, desde cuando y que mensaje te aparece.'
                  value={issueForm.description}
                  onChange={event => setIssueForm(current => ({ ...current, description: event.target.value }))}
                />
              </label>
              <button type='button' className={styles.primaryButton} onClick={() => void submitSupportIssue()}>
                Enviar a soporte
              </button>
            </div>
          </div>
        </div>
      )}

      {renewalAccount && !isSubclientProfile && (
        <div className={styles.modalOverlay}>
          <div className={styles.modalCard}>
            <div className={styles.modalHeader}>
              <div>
                <span className={styles.blockEyebrow}>Renovacion</span>
                <h3>{renewalAccount.accountEmail}</h3>
              </div>
              <button type='button' className={styles.modalClose} onClick={() => setRenewalAccount(null)}>
                Cerrar
              </button>
            </div>
            <div className={styles.formStack}>
              <div className={styles.priceBox}>
                Precio de renovacion: <strong>{formatMoney(renewalAccount.renewalPrice)}</strong>
              </div>
              <label className={styles.fieldLabel}>
                <span>Comprobante de pago</span>
                <span className={styles.fileButton}>
                  Adjuntar captura del pago
                  <input
                    type='file'
                    accept='image/*'
                    onChange={event => void handleFileChange(event, setRenewalProofDataUrl)}
                  />
                </span>
              </label>
              {renewalProofDataUrl && (
                <img className={styles.previewImage} src={renewalProofDataUrl} alt='Captura de pago' />
              )}
              <button type='button' className={styles.primaryButton} onClick={() => void submitRenewal()}>
                Enviar renovacion
              </button>
            </div>
          </div>
        </div>
      )}

      {buyProduct && (
        <div className={styles.modalOverlay}>
          <div className={styles.modalCard}>
            <div className={styles.modalHeader}>
              <div>
                <span className={styles.blockEyebrow}>Comprar plan</span>
                <h3>{buyProduct.title}</h3>
              </div>
              <button type='button' className={styles.modalClose} onClick={() => setBuyProduct(null)}>
                Cerrar
              </button>
            </div>
            <div className={styles.formStack}>
              <div className={styles.priceBox}>
                Precio final: <strong>{formatMoney(buyProduct.effectivePrice)}</strong>
              </div>
              <label className={styles.fieldLabel}>
                <span>Comprobante de compra</span>
                <span className={styles.fileButton}>
                  Adjuntar captura del pago
                  <input
                    type='file'
                    accept='image/*'
                    onChange={event => void handleFileChange(event, setPurchaseProofDataUrl)}
                  />
                </span>
              </label>
              {purchaseProofDataUrl && (
                <img className={styles.previewImage} src={purchaseProofDataUrl} alt='Comprobante de compra' />
              )}
              <button type='button' className={styles.primaryButton} onClick={() => void submitPurchase()}>
                Enviar compra
              </button>
            </div>
          </div>
        </div>
      )}

      {pendingUserOpen && (
        <div className={styles.modalOverlay}>
          <div className={styles.modalCard}>
            <div className={styles.modalHeader}>
              <div>
                <span className={styles.blockEyebrow}>Usuarios</span>
                <h3>Crear usuario pendiente</h3>
              </div>
              <button
                type='button'
                className={styles.modalClose}
                onClick={() => {
                  setPendingUserOpen(false)
                  setPendingUsername('')
                }}
              >
                Cerrar
              </button>
            </div>
            <div className={styles.formStack}>
              <div className={styles.emptyCard}>
                {panelRole === 'owner'
                  ? 'Puedes crear uno o varios usuarios. Para masivo usa: usuario1,usuario2,usuario3.'
                  : 'Solo crea el nombre. Luego esa persona entra a /subcliente, completa telefono, contrasena y su codigo de 4 digitos.'}
              </div>
              {panelRole === 'owner' ? (
                <label className={styles.fieldLabel}>
                  <span>Usuarios a crear</span>
                  <textarea
                    className={styles.textarea}
                    placeholder={'Uno o varios usuarios\nusuario1,usuario2,usuario3'}
                    value={pendingUsername}
                    onChange={event => setPendingUsername(event.target.value)}
                    autoFocus
                  />
                </label>
              ) : (
                <label className={styles.fieldLabel}>
                  <span>Nombre del subcliente</span>
                  <input
                    className={styles.input}
                    placeholder='Ejemplo: cliente123'
                    value={pendingUsername}
                    onChange={event => setPendingUsername(event.target.value)}
                    autoFocus
                  />
                </label>
              )}
              <button
                type='button'
                className={styles.primaryButton}
                onClick={() => void submitPendingUser()}
                disabled={saving}
              >
                Crear usuario
              </button>
            </div>
          </div>
        </div>
      )}

      {childAssignOpen && (
        <div className={styles.modalOverlay}>
          <div className={styles.modalCardWide}>
            <div className={styles.modalHeader}>
              <div>
                <span className={styles.blockEyebrow}>Subclientes</span>
                <h3>Asignar cuenta</h3>
              </div>
              <button
                type='button'
                className={styles.modalClose}
                onClick={() => {
                  setChildAssignOpen(false)
                  setChildAssignUserId('')
                  setChildAssignAccountId('')
                  setChildAssignCutoffDate('')
                  setChildAssignSearch('')
                  setChildAssignAccountSearch('')
                  setChildAssignPickerOpen(false)
                  setChildAccountPickerOpen(false)
                }}
              >
                Cerrar
              </button>
            </div>
            <div className={styles.formStack}>
              {selectedChildAssignUser ? (
                <div className={styles.selectedUserCard}>
                  <div>
                    <span className={styles.blockEyebrow}>Subcliente seleccionado</span>
                    <strong>{selectedChildAssignUser.username}</strong>
                    <small>{selectedChildAssignUser.accounts.length} cuentas actuales</small>
                  </div>
                  <button
                    type='button'
                    className={styles.ghostButton}
                    onClick={() => {
                      setChildAssignUserId('')
                      setChildAssignSearch('')
                      setChildAssignPickerOpen(false)
                    }}
                  >
                    Cambiar
                  </button>
                </div>
              ) : (
                <div className={styles.assignLookup}>
                  <div className={styles.assignSearchRow}>
                    <label className={styles.fieldLabel}>
                      <span>Buscar subcliente</span>
                      <input
                        className={styles.input}
                        placeholder='Escribe el nombre y pulsa buscar'
                        value={childAssignSearch}
                        onChange={event => {
                          setChildAssignSearch(event.target.value)
                          setChildAssignPickerOpen(true)
                        }}
                        onFocus={() => setChildAssignPickerOpen(true)}
                        onClick={() => setChildAssignPickerOpen(true)}
                        onKeyDown={event => {
                          if (event.key === 'Enter') {
                            event.preventDefault()
                            setChildAssignPickerOpen(true)
                          }

                          if (event.key === 'Escape') {
                            setChildAssignPickerOpen(false)
                          }
                        }}
                      />
                    </label>
                    <button
                      type='button'
                      className={styles.secondaryButton}
                      onClick={() => setChildAssignPickerOpen(true)}
                    >
                      Buscar
                    </button>
                  </div>
                  {childAssignPickerOpen && (
                    <div className={styles.searchPicker}>
                      {childAssignableUsers.length === 0 ? (
                        <div className={styles.emptyInline}>No hay subclientes con ese nombre.</div>
                      ) : (
                        childAssignableUsers.map(user => (
                          <button
                            key={user.id}
                            type='button'
                            className={styles.searchOption}
                            onClick={() => {
                              setChildAssignUserId(user.id)
                              setChildAssignSearch(user.username)
                              setChildAssignPickerOpen(false)
                            }}
                          >
                            <strong>{user.username}</strong>
                            <span>{user.accounts.length} cuentas</span>
                          </button>
                        ))
                      )}
                    </div>
                  )}
                </div>
              )}

              <div className={styles.fieldLabel}>
                <span>Cuenta a compartir</span>
                <div className={styles.accountPicker}>
                  {selectedChildAssignAccount ? (
                    <div className={styles.selectedUserCard}>
                      <div>
                        <span className={styles.blockEyebrow}>Cuenta seleccionada</span>
                        <strong>{selectedChildAssignAccount.serviceName}</strong>
                        <small>{selectedChildAssignAccount.accountEmail}</small>
                      </div>
                      <button
                        type='button'
                        className={styles.ghostButton}
                        onClick={() => {
                          setChildAssignAccountId('')
                          setChildAssignAccountSearch('')
                          setChildAccountPickerOpen(true)
                        }}
                      >
                        Cambiar
                      </button>
                    </div>
                  ) : (
                    <div className={styles.accountPickerSearchWrap}>
                      <input
                        className={styles.input}
                        placeholder='Busca por servicio o correo'
                        value={childAssignAccountSearch}
                        onChange={event => {
                          setChildAssignAccountSearch(event.target.value)
                          setChildAccountPickerOpen(true)
                        }}
                        onFocus={() => setChildAccountPickerOpen(true)}
                        onClick={() => setChildAccountPickerOpen(true)}
                        onKeyDown={event => {
                          if (event.key === 'Enter') {
                            event.preventDefault()
                            setChildAccountPickerOpen(true)
                          }

                          if (event.key === 'Escape') {
                            setChildAccountPickerOpen(false)
                          }
                        }}
                      />
                      <button
                        type='button'
                        className={styles.accountPickerMiniButton}
                        onClick={() => setChildAccountPickerOpen(current => !current)}
                      >
                        v
                      </button>
                    </div>
                  )}
                  <button
                    type='button'
                    className={styles.accountPickerButtonHidden}
                    onClick={() => setChildAccountPickerOpen(current => !current)}
                  >
                    {selectedChildAssignAccount ? (
                      <span className={styles.accountPickerSelected}>
                        <strong>{selectedChildAssignAccount.serviceName}</strong>
                        <small>{selectedChildAssignAccount.accountEmail}</small>
                      </span>
                    ) : (
                      <span className={styles.accountPickerPlaceholder}>Selecciona una cuenta</span>
                    )}
                    <span className={styles.accountPickerChevron}>⌄</span>
                  </button>

                  {childAccountPickerOpen && (
                    <div className={styles.accountPickerMenu}>
                      {childAssignableAccounts.length === 0 ? (
                        <div className={styles.emptyInline}>No tienes cuentas para compartir.</div>
                      ) : (
                        childAssignableAccounts.map(account => (
                          <button
                            key={account.id}
                            type='button'
                            className={
                              childAssignAccountId === account.id
                                ? styles.accountPickerOptionActive
                                : styles.accountPickerOption
                            }
                            onClick={() => {
                              setChildAssignAccountId(account.id)
                              setChildAssignAccountSearch(account.accountEmail)
                              setChildAccountPickerOpen(false)
                            }}
                          >
                            <span>
                              <strong>{account.serviceName}</strong>
                              <small>{account.accountEmail}</small>
                            </span>
                            {renderDaysBadge(account.daysRemaining)}
                          </button>
                        ))
                      )}
                    </div>
                  )}
                </div>
              </div>

              <label className={styles.fieldLabel}>
                <span>Fecha de corte para el subcliente</span>
                <input
                  className={styles.input}
                  type='date'
                  value={childAssignCutoffDate}
                  onChange={event => setChildAssignCutoffDate(event.target.value)}
                />
              </label>

              <div className={styles.assignHint}>
                La misma cuenta solo puede bajar 5 veces en total. Si quitas esta cuenta, tambien se quita de sus subclientes.
              </div>

              <button
                type='button'
                className={styles.primaryButton}
                onClick={() => void submitChildAssign()}
                disabled={saving}
              >
                Guardar asignacion
              </button>
            </div>
          </div>
        </div>
      )}

      {assignOpen && (
        <div className={styles.modalOverlay}>
          <div className={styles.modalCardWide}>
            <div className={styles.modalHeader}>
              <div>
                <span className={styles.blockEyebrow}>Asignacion</span>
                <h3>Agregar cuenta</h3>
              </div>
              <button type='button' className={styles.modalClose} onClick={resetAssignModal}>
                Cerrar
              </button>
            </div>

            <div className={styles.formStack}>
              <div className={styles.assignLookup}>
                {selectedAssignUser && !assignHasInlineUsers && (
                  <div className={styles.selectedUserCard}>
                    <div>
                      <span className={styles.blockEyebrow}>Usuario seleccionado</span>
                      <strong>{selectedAssignUser.username}</strong>
                      <small>{selectedAssignUser.activeAccounts} cuentas activas</small>
                    </div>
                    <button
                      type='button'
                      className={styles.ghostButton}
                      onClick={() => {
                        setAssignUserId('')
                        setAssignSearch('')
                        setAssignPickerOpen(false)
                      }}
                    >
                      Cambiar
                    </button>
                  </div>
                )}
                {(!selectedAssignUser || assignHasInlineUsers) && (
                  <div className={styles.assignSearchRow}>
                    <label className={styles.fieldLabel}>
                      <span>Usuario que recibira la cuenta</span>
                      <input
                        className={styles.input}
                        placeholder={
                          assignHasInlineUsers
                            ? 'Usuario por linea activado en asignacion masiva'
                            : 'Buscar usuario por nombre'
                        }
                        value={assignSearch}
                        disabled={assignHasInlineUsers}
                        onChange={event => {
                          setAssignSearch(event.target.value)
                          setAssignPickerOpen(true)
                        }}
                        onFocus={() => {
                          if (!assignHasInlineUsers) {
                            setAssignPickerOpen(true)
                          }
                        }}
                        onClick={() => {
                          if (!assignHasInlineUsers) {
                            setAssignPickerOpen(true)
                          }
                        }}
                        onKeyDown={event => {
                          if (event.key === 'Enter' && !assignHasInlineUsers) {
                            event.preventDefault()
                            setAssignPickerOpen(true)
                          }

                          if (event.key === 'Escape') {
                            setAssignPickerOpen(false)
                          }
                        }}
                      />
                    </label>
                    <button
                      type='button'
                      className={styles.secondaryButton}
                      disabled={assignHasInlineUsers}
                      onClick={() => setAssignPickerOpen(true)}
                    >
                      Buscar
                    </button>
                  </div>
                )}
                {assignPickerOpen && !assignHasInlineUsers && !selectedAssignUser && (
                  <div className={styles.searchPicker}>
                    {searchableUsers.length === 0 ? (
                      <div className={styles.emptyInline}>No hay usuarios con ese nombre.</div>
                    ) : (
                      searchableUsers.map(user => (
                        <button
                          key={user.id}
                          type='button'
                          className={assignUserId === user.id ? styles.searchOptionActive : styles.searchOption}
                          onClick={() => {
                            setAssignUserId(user.id)
                            setAssignSearch(user.username)
                            setAssignPickerOpen(false)
                          }}
                        >
                          <strong>{user.username}</strong>
                          <span>{user.activeAccounts} activas</span>
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>
              <div className={styles.formGrid}>
                <label className={styles.fieldLabel}>
                  <span>Servicio</span>
                  <input
                    className={styles.input}
                    placeholder='Ejemplo: Netflix'
                    value={assignForm.serviceName}
                    onChange={event => setAssignForm(current => ({ ...current, serviceName: event.target.value }))}
                  />
                </label>
                <label className={styles.fieldLabel}>
                  <span>Tipo de cuenta</span>
                  <input
                    className={styles.input}
                    placeholder='Ejemplo: Cuenta completa'
                    value={assignForm.accountType}
                    onChange={event => setAssignForm(current => ({ ...current, accountType: event.target.value }))}
                  />
                </label>
                <label className={styles.fieldLabel}>
                  <span>Fecha de corte</span>
                  <input
                    className={styles.input}
                    type='date'
                    value={assignForm.cutoffDate}
                    disabled={assignHasInlineData}
                    onChange={event => setAssignForm(current => ({ ...current, cutoffDate: event.target.value }))}
                  />
                </label>
                <label className={styles.fieldLabel}>
                  <span>Precio de renovacion</span>
                  <input
                    className={styles.input}
                    placeholder='Solo numero, ejemplo: 65'
                    value={assignForm.renewalPrice}
                    inputMode='decimal'
                    onChange={event =>
                      setAssignForm(current => ({
                        ...current,
                        renewalPrice: sanitizeNumericInput(event.target.value),
                      }))
                    }
                  />
                </label>
              </div>
              <label className={styles.fieldLabel}>
                <span>Correos a asignar</span>
                <textarea
                  className={styles.textarea}
                  placeholder={'Uno por linea o masivo con fecha/usuario\ncorreo@dominio.com\ncorreo1,correo2|12/02/2026\ncorreo1,correo2|12/03/2026|usuario'}
                  value={assignForm.emailsText}
                  onChange={event => setAssignForm(current => ({ ...current, emailsText: event.target.value }))}
                />
              </label>
              <div className={styles.assignHint}>
                {assignHasInlineData
                  ? 'Modo masivo detectado: la fecha de corte se toma de cada linea despues de |.'
                  : 'Si no usas |, se aplicara el usuario y la fecha de corte seleccionados arriba.'}
              </div>
              <div className={styles.excelImportCard}>
                <div className={styles.excelImportHeader}>
                  <div>
                    <span className={styles.blockEyebrow}>Importar Excel</span>
                    <strong>Asignacion masiva con preview</strong>
                    <small>
                      Lee Cuenta, Cliente y Corte. El cliente usa solo el nombre antes de @dominio.com.
                    </small>
                  </div>
                  <label className={styles.fileButton}>
                    {assignExcelFileName || 'Subir Excel'}
                    <input
                      type='file'
                      accept='.xlsx,.xls,.csv'
                      onChange={async event => {
                        const file = event.target.files?.[0] || null
                        setAssignExcelPreview(null)
                        setAssignExcelFileName(file?.name || '')
                        setAssignExcelDataUrl(await fileToDataUrl(file))
                      }}
                    />
                  </label>
                </div>
                <button
                  type='button'
                  className={styles.secondaryButton}
                  onClick={() => void previewExcelAssign()}
                  disabled={saving || !assignExcelDataUrl}
                >
                  Previsualizar Excel
                </button>
                {assignExcelPreview && (
                  <div className={styles.excelPreviewGrid}>
                    <div className={styles.excelPreviewGood}>
                      <strong>Se asignaran {assignExcelPreview.assignments.length} cuentas</strong>
                      <div className={styles.excelPreviewList}>
                        {assignExcelPreview.assignments.slice(0, 80).map((item, index) => (
                          <span key={`${item.userId}-${item.email}-${index}`}>
                            {item.email}|{item.username}|{item.cutoffDate || 'sin corte'}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div className={styles.excelPreviewBad}>
                      <strong>Omitidas / error: {assignExcelPreview.omitted.length}</strong>
                      <div className={styles.excelPreviewList}>
                        {assignExcelPreview.omitted.length === 0 ? (
                          <span>Sin errores detectados.</span>
                        ) : (
                          assignExcelPreview.omitted.slice(0, 80).map((item, index) => (
                            <span key={`${item.email}-${index}`}>
                              {item.email}|{item.reason}
                            </span>
                          ))
                        )}
                      </div>
                    </div>
                    <button
                      type='button'
                      className={styles.primaryButton}
                      onClick={() => void confirmExcelAssign()}
                      disabled={saving || assignExcelPreview.assignments.length === 0}
                    >
                      Confirmar importacion
                    </button>
                  </div>
                )}
              </div>
              {assignHasInlineUsers && (
                <div className={styles.assignHint}>
                  Usuario por linea activado: el selector superior queda desactivado para evitar mezclas.
                </div>
              )}
              {bulkUserSuggestions.length > 0 && (
                <div className={styles.suggestionRow}>
                  <span>Sugerencias:</span>
                  {bulkUserSuggestions.map(user => (
                    <button
                      key={user.id}
                      type='button'
                      className={styles.suggestionChip}
                      onClick={() => applyBulkUserSuggestion(user.username)}
                    >
                      {user.username}
                    </button>
                  ))}
                </div>
              )}
              <button
                type='button'
                className={styles.primaryButton}
                onClick={() => void submitAssign()}
                disabled={saving}
              >
                Guardar asignacion
              </button>
            </div>
          </div>
        </div>
      )}

      {editAccountOpen && (
        <div className={styles.modalOverlay}>
          <div className={styles.modalCard}>
            <div className={styles.modalHeader}>
              <div>
                <span className={styles.blockEyebrow}>Cuenta</span>
                <h3>Editar cuenta</h3>
              </div>
              <button
                type='button'
                className={styles.modalClose}
                onClick={() => {
                  setEditAccountOpen(false)
                  setEditAccountForm(defaultAccountEditForm)
                }}
              >
                Cerrar
              </button>
            </div>
            <div className={styles.formStack}>
              <label className={styles.fieldLabel}>
                <span>Servicio</span>
                <input
                  className={styles.input}
                  placeholder='Ejemplo: Netflix'
                  value={editAccountForm.serviceName}
                  disabled={!canEditAccountIdentity}
                  onChange={event => setEditAccountForm(current => ({ ...current, serviceName: event.target.value }))}
                />
              </label>
              <label className={styles.fieldLabel}>
                <span>Correo de la cuenta</span>
                <input
                  className={styles.input}
                  placeholder='correo@dominio.com'
                  value={editAccountForm.accountEmail}
                  disabled={!canEditAccountIdentity}
                  onChange={event => setEditAccountForm(current => ({ ...current, accountEmail: event.target.value }))}
                />
              </label>
              <label className={styles.fieldLabel}>
                <span>Tipo de cuenta</span>
                <input
                  className={styles.input}
                  placeholder='Ejemplo: Cuenta completa'
                  value={editAccountForm.accountType}
                  disabled={!canEditAccountIdentity}
                  onChange={event => setEditAccountForm(current => ({ ...current, accountType: event.target.value }))}
                />
              </label>
              <label className={styles.fieldLabel}>
                <span>Fecha de corte</span>
                <input
                  className={styles.input}
                  type='date'
                  value={editAccountForm.cutoffDate}
                  onChange={event => setEditAccountForm(current => ({ ...current, cutoffDate: event.target.value }))}
                />
              </label>
              <label className={styles.fieldLabel}>
                <span>Precio de renovacion</span>
                <input
                  className={styles.input}
                  placeholder='Solo numero, ejemplo: 65'
                  value={editAccountForm.renewalPrice}
                  inputMode='decimal'
                  onChange={event =>
                    setEditAccountForm(current => ({
                      ...current,
                      renewalPrice: sanitizeNumericInput(event.target.value),
                    }))
                  }
                />
              </label>
              <label className={styles.fieldLabel}>
                <span>Dias que cubre la renovacion</span>
                <input
                  className={styles.input}
                  placeholder='Ejemplo: 30'
                  value={editAccountForm.renewalPeriodDays}
                  inputMode='numeric'
                  onChange={event =>
                    setEditAccountForm(current => ({
                      ...current,
                      renewalPeriodDays: event.target.value.replace(/\D/g, ''),
                    }))
                  }
                />
              </label>
              <label className={styles.fieldLabel}>
                <span>Estado de la cuenta</span>
                <select
                  className={styles.input}
                  value={editAccountForm.status}
                  onChange={event => setEditAccountForm(current => ({ ...current, status: event.target.value }))}
                >
                  <option value='activa'>Activa</option>
                  <option value='pausada'>Pausada</option>
                  <option value='sin_pago'>Sin pago</option>
                  <option value='desactivada'>Desactivada</option>
                </select>
              </label>
              <div className={styles.assignHint}>
                {canEditAccountIdentity
                  ? 'Este cambio se aplica a la cuenta principal y a todos sus subclientes.'
                  : 'Solo puedes editar fecha, renovacion y estado para tus usuarios. El correo lo maneja el owner.'}
              </div>
              <button
                type='button'
                className={styles.primaryButton}
                onClick={() => void submitEditAccount()}
                disabled={saving}
              >
                Guardar cambios
              </button>
            </div>
          </div>
        </div>
      )}

      {productOpen && (
        <div className={styles.modalOverlay}>
          <div className={styles.modalCardWide}>
            <div className={styles.modalHeader}>
              <div>
                <span className={styles.blockEyebrow}>Ventas</span>
                <h3>Agregar producto</h3>
              </div>
              <button type='button' className={styles.modalClose} onClick={() => setProductOpen(false)}>
                Cerrar
              </button>
            </div>

            <div className={styles.formStack}>
              <div className={styles.formGrid}>
                <label className={styles.fieldLabel}>
                  <span>Titulo del producto</span>
                  <input
                    className={styles.input}
                    placeholder='Ejemplo: Netflix x 2 meses'
                    value={productForm.title}
                    onChange={event => setProductForm(current => ({ ...current, title: event.target.value }))}
                  />
                </label>
                <div className={styles.switchRow}>
                  <span>Proveedor</span>
                  <strong>{profile?.username || productForm.providerName || 'owner'}</strong>
                </div>
                <label className={styles.fieldLabel}>
                  <span>Precio general</span>
                  <input
                    className={styles.input}
                    placeholder='Solo numero, ejemplo: 70'
                    value={productForm.price}
                    inputMode='decimal'
                    onChange={event =>
                      setProductForm(current => ({
                        ...current,
                        price: sanitizeNumericInput(event.target.value),
                      }))
                    }
                  />
                </label>
                <label className={styles.switchRow}>
                  <span>En stock</span>
                  <input
                    type='checkbox'
                    checked={productForm.inStock}
                    onChange={event =>
                      setProductForm(current => ({ ...current, inStock: event.target.checked }))
                    }
                  />
                </label>
              </div>

              <label className={styles.fieldLabel}>
                <span>Imagen del producto</span>
                <span className={styles.fileButton}>
                  Subir imagen del producto
                  <input
                    type='file'
                    accept='image/*'
                    onChange={event =>
                      void handleFileChange(event, value =>
                        setProductForm(current => ({ ...current, imageDataUrl: value }))
                      )
                    }
                  />
                </span>
              </label>
              {productForm.imageDataUrl && (
                <img className={styles.previewImage} src={productForm.imageDataUrl} alt='Producto' />
              )}

              <div className={styles.specialPriceCard}>
                <div className={styles.blockHeader}>
                  <div>
                    <span className={styles.blockEyebrow}>Precio especial</span>
                    <h3>Asignar por usuario</h3>
                  </div>
                </div>
                <label className={styles.fieldLabel}>
                  <span>Buscar usuario para precio especial</span>
                  <input
                    className={styles.input}
                    placeholder='Escribe el nombre del usuario'
                    value={productForm.search}
                    onChange={event => setProductForm(current => ({ ...current, search: event.target.value }))}
                  />
                </label>
                <div className={styles.searchPicker}>
                  {getPageItems('product-special-users', productSpecialUsers).map(user => (
                      <button
                        key={user.id}
                        type='button'
                        className={
                          productForm.pendingUserId === user.id
                            ? styles.searchOptionActive
                            : styles.searchOption
                        }
                        onClick={() =>
                          setProductForm(current => ({ ...current, pendingUserId: user.id }))
                        }
                      >
                        <strong>{user.username}</strong>
                        <span>{user.activeAccounts} activas</span>
                      </button>
                    ))}
                </div>
                {renderPagination('product-special-users', productSpecialUsers.length)}
                <div className={styles.inlineActions}>
                  <label className={styles.fieldLabel}>
                    <span>Precio especial</span>
                    <input
                      className={styles.input}
                      placeholder='Solo numero'
                      value={productForm.pendingSpecialPrice}
                      inputMode='decimal'
                      onChange={event =>
                        setProductForm(current => ({
                          ...current,
                          pendingSpecialPrice: sanitizeNumericInput(event.target.value),
                        }))
                      }
                    />
                  </label>
                  <button type='button' className={styles.secondaryButton} onClick={addSpecialPriceRow}>
                    Agregar precio
                  </button>
                </div>
                {productForm.specialRows.length > 0 && (
                  <div className={styles.subList}>
                    {productForm.specialRows.map(row => {
                      const user = (panelData?.allUsers || []).find(item => item.id === row.userId)
                      return (
                        <div key={row.userId} className={styles.subCard}>
                          <div>
                            <strong>{user?.username || row.userId}</strong>
                            <span>{formatMoney(Number(row.specialPrice || 0))}</span>
                          </div>
                          <button
                            type='button'
                            className={styles.ghostButton}
                            onClick={() =>
                              setProductForm(current => ({
                                ...current,
                                specialRows: current.specialRows.filter(item => item.userId !== row.userId),
                              }))
                            }
                          >
                            Quitar
                          </button>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>

              <button
                type='button'
                className={styles.primaryButton}
                onClick={() => void submitProduct()}
                disabled={saving}
              >
                Guardar producto
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}
