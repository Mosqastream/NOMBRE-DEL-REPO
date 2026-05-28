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
] as const

const OWNER_SECTIONS = [
  { id: 'vip', label: 'Usuarios', icon: 'crown' },
  { id: 'solicitudes', label: 'Solicitudes', icon: 'bell' },
  { id: 'asignacion', label: 'Asignacion', icon: 'spark' },
  { id: 'ventas', label: 'Ventas', icon: 'clock' },
  { id: 'historial', label: 'Historial', icon: 'clock' },
] as const

type SectionIconName =
  | (typeof USER_SECTIONS)[number]['icon']
  | (typeof OWNER_SECTIONS)[number]['icon']

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

type PanelApiPayload = {
  error?: string
  message?: string
  requestId?: string | null
  accountId?: string
  accounts?: PanelAccount[]
  product?: PanelProduct
  productId?: string
  saleId?: string
}

type OwnerAccountFilter = 'todos' | 'vigentes' | 'por_vencer' | 'vencidas'

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
  return normalizePanelPayload({
    ...payload,
    accounts: (payload.accounts || []).filter(account => account.id !== accountId),
    allUsers: (payload.allUsers || []).map(user => {
      const nextAccounts = (user.accounts || []).filter(account => account.id !== accountId)
      return {
        ...user,
        activeAccounts: nextAccounts.filter(account => account.status === 'activa').length,
        accounts: nextAccounts,
      }
    }),
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
  const [ownerAccountFilter, setOwnerAccountFilter] = useState<OwnerAccountFilter>('todos')
  const [supportChoiceAccount, setSupportChoiceAccount] = useState<PanelAccount | null>(null)
  const [issueAccount, setIssueAccount] = useState<PanelAccount | null>(null)
  const [renewalAccount, setRenewalAccount] = useState<PanelAccount | null>(null)
  const [buyProduct, setBuyProduct] = useState<PanelProduct | null>(null)
  const [assignOpen, setAssignOpen] = useState(false)
  const [productOpen, setProductOpen] = useState(false)
  const [assignSearch, setAssignSearch] = useState('')
  const [assignUserId, setAssignUserId] = useState('')
  const [issueForm, setIssueForm] = useState<SupportIssueForm>(defaultIssueForm)
  const [messageForm, setMessageForm] = useState<SupportMessageForm>(defaultMessageForm)
  const [renewalProofDataUrl, setRenewalProofDataUrl] = useState<string | null>(null)
  const [purchaseProofDataUrl, setPurchaseProofDataUrl] = useState<string | null>(null)
  const [assignForm, setAssignForm] = useState<AssignForm>(defaultAssignForm)
  const [productForm, setProductForm] = useState<ProductForm>(defaultProductForm())
  const realtimeRefreshRef = useRef<number | null>(null)
  const realtimePollRef = useRef<number | null>(null)
  const refreshInFlightRef = useRef(false)
  const refreshQueuedRef = useRef(false)
  const removedAccountIdsRef = useRef(new Set<string>())
  const productCreatePendingRef = useRef(false)

  const profile = panelData?.profile ?? null
  const panelRole: PanelRole = profile?.role || 'usuario'

  const visibleSections = useMemo(
    () => (panelView === 'owner' ? OWNER_SECTIONS : USER_SECTIONS),
    [panelView]
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
  }, [expandedUserId, ownerAllAccounts, ownerAccountFilter, selectedOwnerUser])

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
    if (panelRole !== 'owner') {
      setPanelView('usuario')
    }
  }, [panelRole])

  useEffect(() => {
    if (panelView === 'owner') {
      if (!OWNER_SECTIONS.some(section => section.id === activeSection)) {
        setActiveSection('vip')
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
    if (profile?.username) {
      setProductForm(current => ({ ...current, providerName: current.providerName || profile.username }))
    }
  }, [profile?.username])

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
  }, [profile?.id])

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

      let normalizedPayload = normalizePanelPayload(payload)
      for (const accountId of removedAccountIdsRef.current) {
        normalizedPayload = removeAccountFromPayload(normalizedPayload, accountId)
      }
      setPanelData(normalizedPayload)
      if (normalizedPayload.profile.role !== 'owner') {
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

  const handleSignOut = async () => {
    await supabase.auth.signOut()
    router.replace('/')
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

  const submitAssign = async () => {
    setSaving(true)
    setError('')
    try {
      if (!assignUserId) {
        throw new Error('Selecciona un usuario para asignarle la cuenta.')
      }

      const emails = assignForm.emailsText
        .split(/[\n,]+/)
        .map(item => item.trim().toLowerCase())
        .filter(Boolean)

      if (emails.length === 0) {
        throw new Error('Agrega al menos un correo para asignar.')
      }

      const payload = await callPanelApi('/api/panel/accounts', {
        action: 'assign',
        userId: assignUserId,
        emails,
        serviceName: assignForm.serviceName,
        accountType: assignForm.accountType,
        cutoffDate: assignForm.cutoffDate,
        renewalPrice: Number(assignForm.renewalPrice || 0),
        renewalPeriodDays: Number(assignForm.renewalPeriodDays || 30),
        status: 'activa',
      })

      if (payload.accounts?.length) {
        for (const account of payload.accounts) {
          removedAccountIdsRef.current.delete(account.id)
        }
        setPanelData(current => (current ? appendAccountsToPayload(current, payload.accounts || []) : current))
        setExpandedUserId(assignUserId)
      }

      setAssignOpen(false)
      setAssignForm(defaultAssignForm)
      setAssignSearch('')
      setAssignUserId('')
      setNotice(payload.message || 'Cuenta asignada.')
      await refreshPanel(true)
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'No se pudo asignar la cuenta.')
    } finally {
      setSaving(false)
    }
  }

  const removeAccount = async (accountId: string) => {
    const snapshot = panelData
    setSaving(true)
    setError('')
    try {
      removedAccountIdsRef.current.add(accountId)
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
      removedAccountIdsRef.current.delete(accountId)
      if (snapshot) {
        setPanelData(snapshot)
      }
      void refreshPanel(true)
      setError(submitError instanceof Error ? submitError.message : 'No se pudo quitar la cuenta.')
    } finally {
      setSaving(false)
    }
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

  const renderViewSwitch = (className: string) =>
    panelRole === 'owner' ? (
      <div className={className}>
        <button
          type='button'
          className={panelView === 'usuario' ? styles.viewButtonActive : styles.viewButton}
          onClick={() => {
            setPanelView('usuario')
            setActiveSection('cuentas')
          }}
        >
          Usuario
        </button>
        <button
          type='button'
          className={panelView === 'owner' ? styles.viewButtonActive : styles.viewButton}
          onClick={() => {
            setPanelView('owner')
            setActiveSection('vip')
          }}
        >
          Owner
        </button>
      </div>
    ) : null

  const renderSectionButtons = (navClassName: string) => (
    <nav className={navClassName} aria-label='Apartados del panel'>
      {visibleSections.map(section => (
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
        </button>
      ))}
    </nav>
  )

  const renderMobileOwnerToggle = () =>
    panelRole === 'owner' ? (
      <button
        type='button'
        className={panelView === 'owner' ? styles.mobileOwnerToggleActive : styles.mobileOwnerToggle}
        onClick={() => {
          if (panelView === 'owner') {
            setPanelView('usuario')
            setActiveSection('cuentas')
            return
          }
          setPanelView('owner')
          setActiveSection('vip')
        }}
      >
        <span className={styles.mobileOwnerToggleText}>Owner</span>
        <span className={styles.mobileOwnerTrack}>
          <span className={styles.mobileOwnerThumb} />
        </span>
      </button>
    ) : null

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
    const accounts = panelData?.accounts || []

    return (
      <div className={styles.sectionStack}>
        <div className={styles.blockCard}>
          <div className={styles.blockHeader}>
            <div>
              <span className={styles.blockEyebrow}>Cuentas registradas</span>
              <h3>Tus cuentas activas</h3>
            </div>
          </div>

          {accounts.length === 0 ? (
            <div className={styles.emptyCard}>Todavia no tienes cuentas asignadas.</div>
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
                    {accounts.map(account => (
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
                            <button
                              type='button'
                              className={styles.primaryButton}
                              onClick={() => setRenewalAccount(account)}
                            >
                              Renovacion
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className={styles.cardGrid}>
                {accounts.map(account => (
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
                      <button
                        type='button'
                        className={styles.primaryButton}
                        onClick={() => setRenewalAccount(account)}
                      >
                        Renovacion
                      </button>
                    </div>
                  </article>
                ))}
              </div>
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
              <textarea
                className={styles.textarea}
                placeholder='Escribe tu mensaje para el chat en vivo...'
                value={messageForm.body}
                onChange={event => setMessageForm(current => ({ ...current, body: event.target.value }))}
              />
              <div className={styles.composerActions}>
                <label className={styles.fileButton}>
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

  const renderGestionSection = () => (
    <div className={styles.sectionStack}>
      <div className={styles.blockCard}>
        <div className={styles.blockHeader}>
          <div>
            <span className={styles.blockEyebrow}>Usuarios</span>
            <h3>Esta parte va con tu otra logica</h3>
          </div>
        </div>
        <div className={styles.emptyCard}>
          La dejamos lista para enchufar la logica especial que me vas a pasar luego.
        </div>
      </div>
    </div>
  )

  const renderHistorialSection = (ownerMode: boolean) => (
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
          <div className={styles.cardGrid}>
            {currentHistory.map(item => (
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
        )}
      </div>
    </div>
  )

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
        <div className={styles.emptyCard}>
          Aqui solo aparecen los correos que tengas asignados dentro de tus cuentas activas.
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
                                  onClick={() => void removeAccount(account.id)}
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

  const renderOwnerUsersSectionV2 = () => (
    <div className={styles.sectionStack}>
      <div className={styles.ownerUsersLayout}>
        <div className={styles.blockCard}>
          <div className={styles.blockHeader}>
            <div>
              <span className={styles.blockEyebrow}>Usuarios</span>
              <h3>Clientes y usuarios</h3>
            </div>
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
                  <span>Todas tus cuentas asignadas</span>
                </div>
                <div className={styles.ownerUserMeta}>
                  <span className={styles.badgeMuted}>General</span>
                  <strong className={styles.ownerUserCount}>{ownerAllAccounts.length}</strong>
                </div>
              </button>

              {ownerUsers.length === 0 ? (
                <div className={styles.emptyCard}>No hay usuarios que coincidan con la busqueda.</div>
              ) : (
                ownerUsers.map(user => (
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
                      <span>Registro: {formatDate(user.createdAt)}</span>
                    </div>
                    <div className={styles.ownerUserMeta}>
                      {renderStatusBadge(user.role)}
                      <strong className={styles.ownerUserCount}>{user.accounts.length}</strong>
                    </div>
                  </button>
                ))
              )}
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
                    {filteredOwnerAccounts.map(account => (
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
                              className={styles.ghostButton}
                              onClick={() => void removeAccount(account.id)}
                            >
                              Quitar cuenta
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className={styles.cardGrid}>
                {filteredOwnerAccounts.map(account => (
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
                        className={styles.ghostButton}
                        onClick={() => void removeAccount(account.id)}
                      >
                        Quitar cuenta
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )

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

  const renderSupportSectionV2 = (ownerMode: boolean) => (
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
              <textarea
                className={styles.textarea}
                placeholder='Escribe tu mensaje para el chat en vivo...'
                value={messageForm.body}
                onChange={event => setMessageForm(current => ({ ...current, body: event.target.value }))}
              />
              <div className={styles.composerActions}>
                <label className={styles.fileButton}>
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

  const renderComprasSectionV2 = () => {
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
          )}
        </div>
      </div>
    )
  }

  const renderVentasSectionV2 = () => (
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
      </div>
    </div>
  )

  const renderCurrentSection = () => {
    if (panelView === 'owner') {
      if (activeSection === 'vip') return renderOwnerUsersSectionV2()
      if (activeSection === 'solicitudes') return renderSupportSectionV2(true)
      if (activeSection === 'asignacion') return renderAssignSection()
      if (activeSection === 'ventas') return renderVentasSectionV2()
      if (activeSection === 'historial') return renderHistorialSection(true)
      return renderOwnerUsersSectionV2()
    }

    if (activeSection === 'cuentas') return renderAccountsSection()
    if (activeSection === 'soporte') return renderSupportSectionV2(false)
    if (activeSection === 'gestion') return renderGestionSection()
    if (activeSection === 'compras') return renderComprasSectionV2()
    if (activeSection === 'codigos') return renderCodigosSection()
    if (activeSection === 'historial') return renderHistorialSection(false)
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
              {renderViewSwitch(styles.viewSwitch)}
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
          {renderMobileOwnerToggle()}
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
              <input
                className={styles.input}
                placeholder='Asunto'
                value={issueForm.subject}
                onChange={event => setIssueForm(current => ({ ...current, subject: event.target.value }))}
              />
              <textarea
                className={styles.textarea}
                placeholder='Descripcion'
                value={issueForm.description}
                onChange={event => setIssueForm(current => ({ ...current, description: event.target.value }))}
              />
              <button type='button' className={styles.primaryButton} onClick={() => void submitSupportIssue()}>
                Enviar a soporte
              </button>
            </div>
          </div>
        </div>
      )}

      {renewalAccount && (
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
              <label className={styles.fileButton}>
                Adjuntar captura del pago
                <input
                  type='file'
                  accept='image/*'
                  onChange={event => void handleFileChange(event, setRenewalProofDataUrl)}
                />
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
              <label className={styles.fileButton}>
                Adjuntar captura del pago
                <input
                  type='file'
                  accept='image/*'
                  onChange={event => void handleFileChange(event, setPurchaseProofDataUrl)}
                />
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

      {assignOpen && (
        <div className={styles.modalOverlay}>
          <div className={styles.modalCardWide}>
            <div className={styles.modalHeader}>
              <div>
                <span className={styles.blockEyebrow}>Asignacion</span>
                <h3>Agregar cuenta</h3>
              </div>
              <button type='button' className={styles.modalClose} onClick={() => setAssignOpen(false)}>
                Cerrar
              </button>
            </div>

            <div className={styles.formStack}>
              <input
                className={styles.input}
                placeholder='Buscar usuario por nombre'
                value={assignSearch}
                onChange={event => setAssignSearch(event.target.value)}
              />
              <div className={styles.searchPicker}>
                {searchableUsers.map(user => (
                  <button
                    key={user.id}
                    type='button'
                    className={assignUserId === user.id ? styles.searchOptionActive : styles.searchOption}
                    onClick={() => setAssignUserId(user.id)}
                  >
                    <strong>{user.username}</strong>
                    <span>{user.activeAccounts} activas</span>
                  </button>
                ))}
              </div>
              <div className={styles.formGrid}>
                <input
                  className={styles.input}
                  placeholder='Servicio'
                  value={assignForm.serviceName}
                  onChange={event => setAssignForm(current => ({ ...current, serviceName: event.target.value }))}
                />
                <input
                  className={styles.input}
                  placeholder='Tipo'
                  value={assignForm.accountType}
                  onChange={event => setAssignForm(current => ({ ...current, accountType: event.target.value }))}
                />
                <input
                  className={styles.input}
                  type='date'
                  value={assignForm.cutoffDate}
                  onChange={event => setAssignForm(current => ({ ...current, cutoffDate: event.target.value }))}
                />
                <input
                  className={styles.input}
                  placeholder='Precio de renovacion'
                  value={assignForm.renewalPrice}
                  inputMode='decimal'
                  onChange={event =>
                    setAssignForm(current => ({
                      ...current,
                      renewalPrice: sanitizeNumericInput(event.target.value),
                    }))
                  }
                />
              </div>
              <textarea
                className={styles.textarea}
                placeholder='Correo o varios correos, uno por linea'
                value={assignForm.emailsText}
                onChange={event => setAssignForm(current => ({ ...current, emailsText: event.target.value }))}
              />
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
                <input
                  className={styles.input}
                  placeholder='Titulo'
                  value={productForm.title}
                  onChange={event => setProductForm(current => ({ ...current, title: event.target.value }))}
                />
                <div className={styles.switchRow}>
                  <span>Proveedor</span>
                  <strong>{profile?.username || productForm.providerName || 'owner'}</strong>
                </div>
                <input
                  className={styles.input}
                  placeholder='Precio'
                  value={productForm.price}
                  inputMode='decimal'
                  onChange={event =>
                    setProductForm(current => ({
                      ...current,
                      price: sanitizeNumericInput(event.target.value),
                    }))
                  }
                />
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

              <label className={styles.fileButton}>
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
                <input
                  className={styles.input}
                  placeholder='Buscar usuario'
                  value={productForm.search}
                  onChange={event => setProductForm(current => ({ ...current, search: event.target.value }))}
                />
                <div className={styles.searchPicker}>
                  {(panelData?.allUsers || [])
                    .filter(user =>
                      user.username.toLowerCase().includes(productForm.search.trim().toLowerCase())
                    )
                    .map(user => (
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
                <div className={styles.inlineActions}>
                  <input
                    className={styles.input}
                    placeholder='Precio especial'
                    value={productForm.pendingSpecialPrice}
                    inputMode='decimal'
                    onChange={event =>
                      setProductForm(current => ({
                        ...current,
                        pendingSpecialPrice: sanitizeNumericInput(event.target.value),
                      }))
                    }
                  />
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
