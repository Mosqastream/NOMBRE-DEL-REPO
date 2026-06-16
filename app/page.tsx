'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'
import {
  buildPhoneNumber,
  normalizePhoneCountry,
  normalizePhoneDigits,
  normalizeTelegram,
  normalizeUsername,
  validatePassword,
  validatePhone,
  validateTelegram,
  validateUsername,
} from '@/lib/auth-identity'
import { DEFAULT_PHONE_COUNTRY, PHONE_COUNTRY_OPTIONS } from '@/lib/phone-countries'
import { normalizeSecurityPin, validateSecurityPin } from '@/lib/security-pin-client'
import styles from './page.module.css'

type AuthMode = 'signin' | 'signup'
type PendingAction = 'signin' | 'signup' | null

type AuthSessionPayload = {
  access_token: string
  refresh_token: string
}

const INITIAL_FORM = {
  password: '',
  phoneCountry: DEFAULT_PHONE_COUNTRY,
  phoneDigits: '',
  telegram: '',
  username: '',
}

const getSupabaseStorageKey = () => {
  try {
    const host = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL || '').hostname
    const projectRef = host.split('.')[0]
    return projectRef ? `sb-${projectRef}-auth-token` : null
  } catch {
    return null
  }
}

const persistSessionFallback = (session: AuthSessionPayload) => {
  const storageKey = getSupabaseStorageKey()
  if (!storageKey) return false

  window.localStorage.setItem(
    storageKey,
    JSON.stringify({
      access_token: session.access_token,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      expires_in: 3600,
      refresh_token: session.refresh_token,
      token_type: 'bearer',
      user: null,
    })
  )

  return true
}

function PhoneCountryPicker({
  value,
  onChange,
}: {
  value: string
  onChange: (countryCode: string) => void
}) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')

  const selectedCountry =
    PHONE_COUNTRY_OPTIONS.find(option => option.code === value) || PHONE_COUNTRY_OPTIONS[0]

  const filteredCountries = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    if (!normalizedQuery) return PHONE_COUNTRY_OPTIONS

    return PHONE_COUNTRY_OPTIONS.filter(option => {
      const haystack = `${option.label} ${option.code} ${option.dialCode}`.toLowerCase()
      return haystack.includes(normalizedQuery)
    })
  }, [query])

  useEffect(() => {
    if (!open) return

    const handlePointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false)
      }
    }

    document.addEventListener('mousedown', handlePointerDown)
    return () => document.removeEventListener('mousedown', handlePointerDown)
  }, [open])

  useEffect(() => {
    if (!open) {
      setQuery('')
      return
    }

    const timeoutId = window.setTimeout(() => {
      searchInputRef.current?.focus()
    }, 10)

    return () => window.clearTimeout(timeoutId)
  }, [open])

  return (
    <div ref={rootRef} className={styles.countryPicker}>
      <button
        type='button'
        className={styles.countryTrigger}
        onClick={() => setOpen(current => !current)}
        aria-expanded={open}
        aria-haspopup='listbox'
      >
        <span className={styles.countryTriggerFlag}>{selectedCountry.flag}</span>
        <span className={styles.countryTriggerText}>
          <strong>{selectedCountry.code}</strong>
          <span>
            {selectedCountry.label} (+{selectedCountry.dialCode})
          </span>
        </span>
        <span className={styles.countryChevron}>{open ? '-' : '+'}</span>
      </button>

      {open && (
        <div className={styles.countryPopover}>
          <div className={styles.countrySearchWrap}>
            <input
              ref={searchInputRef}
              type='text'
              value={query}
              onChange={event => setQuery(event.target.value)}
              placeholder='Buscar pais o codigo'
              className={styles.countrySearch}
            />
          </div>

          <div className={styles.countryList} role='listbox'>
            {filteredCountries.map(option => (
              <button
                key={option.code}
                type='button'
                className={option.code === value ? styles.countryOptionActive : styles.countryOption}
                onClick={() => {
                  onChange(option.code)
                  setOpen(false)
                }}
              >
                <span className={styles.countryOptionFlag}>{option.flag}</span>
                <span className={styles.countryOptionBody}>
                  <strong>{option.label}</strong>
                  <span>
                    {option.code} · +{option.dialCode}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function SecurityPinModal({
  error,
  loading,
  mode,
  onClose,
  onSubmit,
}: {
  error: string
  loading: boolean
  mode: AuthMode
  onClose: () => void
  onSubmit: (pin: string) => void
}) {
  const [digits, setDigits] = useState(['', '', '', ''])
  const inputRefs = useRef<Array<HTMLInputElement | null>>([])

  useEffect(() => {
    const timeoutId = window.setTimeout(() => inputRefs.current[0]?.focus(), 40)
    return () => window.clearTimeout(timeoutId)
  }, [])

  const pin = digits.join('')

  const updateDigit = (index: number, rawValue: string) => {
    const nextChar = rawValue.replace(/\D/g, '').slice(-1)
    setDigits(current => {
      const next = [...current]
      next[index] = nextChar
      return next
    })

    if (nextChar && index < 3) {
      inputRefs.current[index + 1]?.focus()
    }
  }

  const handleKeyDown = (index: number, event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Backspace' && !digits[index] && index > 0) {
      inputRefs.current[index - 1]?.focus()
    }

    if (event.key === 'ArrowLeft' && index > 0) {
      inputRefs.current[index - 1]?.focus()
    }

    if (event.key === 'ArrowRight' && index < 3) {
      inputRefs.current[index + 1]?.focus()
    }
  }

  const handlePaste = (event: React.ClipboardEvent<HTMLInputElement>) => {
    event.preventDefault()
    const pasted = normalizeSecurityPin(event.clipboardData.getData('text'))
    if (!pasted) return

    const next = pasted.split('').slice(0, 4)
    while (next.length < 4) next.push('')
    setDigits(next)
    inputRefs.current[Math.min(pasted.length, 4) - 1]?.focus()
  }

  return (
    <div className={styles.modalOverlay}>
      <div className={styles.modalCard}>
        <button type='button' className={styles.modalClose} onClick={onClose}>
          x
        </button>

        <span className={styles.modalKicker}>{mode === 'signup' ? 'Seguridad inicial' : 'Paso extra'}</span>
        <h3>{mode === 'signup' ? 'Crea un codigo de 4 digitos' : 'Ingresa tu codigo de 4 digitos'}</h3>
        <p>
          {mode === 'signup'
            ? 'Este codigo sera tu confirmacion rapida al iniciar sesion.'
            : 'Confirma tu acceso con el codigo que creaste al registrarte.'}
        </p>

        <div className={styles.pinGrid}>
          {digits.map((digit, index) => (
            <input
              key={index}
              ref={element => {
                inputRefs.current[index] = element
              }}
              type='password'
              inputMode='numeric'
              pattern='[0-9]*'
              maxLength={1}
              value={digit}
              onChange={event => updateDigit(index, event.target.value)}
              onKeyDown={event => handleKeyDown(index, event)}
              onPaste={handlePaste}
              className={styles.pinCell}
            />
          ))}
        </div>

        {error && <div className={styles.errorBox}>{error}</div>}

        <button
          type='button'
          className={styles.modalSubmit}
          disabled={loading}
          onClick={() => onSubmit(pin)}
        >
          {loading ? 'Validando...' : mode === 'signup' ? 'Guardar codigo y continuar' : 'Validar y entrar'}
        </button>
      </div>
    </div>
  )
}

export default function HomePage() {
  const router = useRouter()
  const [mode, setMode] = useState<AuthMode>('signin')
  const [form, setForm] = useState(INITIAL_FORM)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [modalError, setModalError] = useState('')
  const [pendingAction, setPendingAction] = useState<PendingAction>(null)

  useEffect(() => {
    let active = true

    const checkSession = async () => {
      const session = await supabase.auth.getSession()
      if (!active) return
      if (session.data.session) {
        router.replace('/panel')
      }
    }

    void checkSession()

    return () => {
      active = false
    }
  }, [router])

  const selectedCountry = useMemo(
    () => PHONE_COUNTRY_OPTIONS.find(option => option.code === form.phoneCountry) || PHONE_COUNTRY_OPTIONS[0],
    [form.phoneCountry]
  )

  const updateField = (field: keyof typeof INITIAL_FORM, value: string) => {
    setForm(current => ({
      ...current,
      [field]: value,
    }))
  }

  const validateSignin = () =>
    validateUsername(form.username) ||
    validatePhone(form.phoneCountry, form.phoneDigits) ||
    validatePassword(form.password)

  const validateSignup = () =>
    validateUsername(form.username) ||
    validatePhone(form.phoneCountry, form.phoneDigits) ||
    validatePassword(form.password) ||
    validateTelegram(form.telegram)

  const loginWithCredentials = async (securityPin: string) => {
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        username: normalizeUsername(form.username),
        phoneCountry: normalizePhoneCountry(form.phoneCountry),
        phoneDigits: normalizePhoneDigits(form.phoneDigits),
        password: form.password,
        securityPin,
      }),
    })

    const payload = (await response.json().catch(() => ({}))) as {
      error?: string
      session?: AuthSessionPayload
    }

    if (!response.ok || !payload.session) {
      throw new Error(payload.error || 'No se pudo iniciar sesion.')
    }

    let setSessionResp: Awaited<ReturnType<typeof supabase.auth.setSession>> | null = null
    try {
      setSessionResp = await supabase.auth.setSession(payload.session)
    } catch {
      if (persistSessionFallback(payload.session)) return
      throw new Error('No se pudo guardar la sesion en este navegador.')
    }

    if (setSessionResp.error) {
      if (persistSessionFallback(payload.session)) return
      throw setSessionResp.error
    }
  }

  const runSignin = async (securityPin: string) => {
    await loginWithCredentials(securityPin)
    router.replace('/panel')
  }

  const runSignup = async (securityPin: string) => {
    const response = await fetch('/api/auth/register', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        username: normalizeUsername(form.username),
        password: form.password,
        phoneCountry: normalizePhoneCountry(form.phoneCountry),
        phoneDigits: normalizePhoneDigits(form.phoneDigits),
        telegram: normalizeTelegram(form.telegram),
        securityPin,
      }),
    })

    const payload = (await response.json().catch(() => ({}))) as { error?: string; message?: string }
    if (!response.ok) {
      throw new Error(payload.error || 'No se pudo crear la cuenta.')
    }

    await loginWithCredentials(securityPin)
    setNotice(payload.message || 'Cuenta creada correctamente.')
    router.replace('/panel')
  }

  const openPinStep = (action: PendingAction) => {
    const validationError = action === 'signup' ? validateSignup() : validateSignin()
    if (validationError) {
      setError(validationError)
      return
    }

    setError('')
    setNotice('')
    setModalError('')
    setPendingAction(action)
  }

  const handlePinSubmit = async (pin: string) => {
    const pinError = validateSecurityPin(pin)
    if (pinError) {
      setModalError(pinError)
      return
    }

    setLoading(true)
    setModalError('')
    setError('')

    try {
      if (pendingAction === 'signup') {
        await runSignup(pin)
        return
      }

      if (pendingAction === 'signin') {
        await runSignin(pin)
      }
    } catch (submitError) {
      setModalError(
        submitError instanceof Error ? submitError.message : 'No se pudo completar la accion.'
      )
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <main className={styles.page}>
        <section className={styles.hero}>
          <div className={styles.heroBackground} aria-hidden='true'>
            <div className={styles.starfield}>
              <span className={styles.starAuraA} />
              <span className={styles.starAuraB} />
              <span className={styles.starTrailOne} />
              <span className={styles.starTrailTwo} />
              <span className={styles.starTrailThree} />
              <span className={styles.starTrailFour} />
              <span className={styles.starDotOne} />
              <span className={styles.starDotTwo} />
              <span className={styles.starDotThree} />
              <span className={styles.starDotFour} />
              <span className={styles.starDotFive} />
              <span className={styles.starDotSix} />
            </div>
          </div>

          <div>
            <div className={styles.brand}>AlexCryx</div>
            <h1>Administrador premium</h1>
            <p>Vive la mejor experiencia con las mejores cuentas del mercado.</p>
          </div>
        </section>

        <section className={styles.authShell}>
          <div className={styles.topRow}>
            <button
              type='button'
              className={mode === 'signin' ? styles.modeActive : styles.modeButton}
              onClick={() => {
                setMode('signin')
                setError('')
                setNotice('')
              }}
            >
              Iniciar sesion
            </button>
            <button
              type='button'
              className={mode === 'signup' ? styles.modeActive : styles.modeButton}
              onClick={() => {
                setMode('signup')
                setError('')
                setNotice('')
              }}
            >
              Registrarse
            </button>
          </div>

          <div className={styles.panel}>
            <div key={mode} className={styles.panelStage}>
              <div className={styles.panelIntro}>
                <span className={styles.kicker}>{mode === 'signup' ? 'Alta inmediata' : 'Acceso directo'}</span>
                <h2>{mode === 'signup' ? 'Crea tu cuenta' : 'Entra a tu cuenta'}</h2>
                <p>
                  {mode === 'signup'
                    ? 'Completa tus datos y luego crea tu codigo de seguridad de 4 digitos.'
                    : 'Ingresa tu nombre de usuario, tu numero de telefono y tu contraseña.'}
                </p>
              </div>

              <div className={styles.formGrid}>
                <label className={styles.field}>
                  <span>Nombre de usuario</span>
                  <input
                    type='text'
                    value={form.username}
                    onChange={event => updateField('username', event.target.value)}
                    placeholder='Ingresa tu nombre de usuario'
                    autoComplete='username'
                  />
                </label>

                <label className={styles.field}>
                  <span>Numero de telefono</span>
                  <div className={styles.phoneRow}>
                    <PhoneCountryPicker
                      value={form.phoneCountry}
                      onChange={countryCode => updateField('phoneCountry', countryCode)}
                    />

                    <div className={styles.phoneInputWrap}>
                      <span className={styles.phoneDialCode}>+{selectedCountry?.dialCode || '51'}</span>
                      <input
                        type='text'
                        value={form.phoneDigits}
                        onChange={event => updateField('phoneDigits', normalizePhoneDigits(event.target.value))}
                        placeholder='Solo numeros'
                        autoComplete='tel-national'
                        inputMode='numeric'
                        pattern='[0-9]*'
                        maxLength={15}
                      />
                    </div>
                  </div>
                </label>

                <label className={styles.field}>
                  <span>{'Contrase\u00f1a'}</span>
                  <input
                    type='password'
                    value={form.password}
                    onChange={event => updateField('password', event.target.value)}
                    placeholder='Minimo 6 caracteres'
                    autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                  />
                </label>

                {mode === 'signup' && (
                  <label className={styles.field}>
                    <span>Telegram opcional</span>
                    <input
                      type='text'
                      value={form.telegram}
                      onChange={event => updateField('telegram', event.target.value)}
                      placeholder='@tuusuario'
                      autoComplete='off'
                    />
                  </label>
                )}
              </div>

              {error && <div className={styles.errorBox}>{error}</div>}
              {notice && <div className={styles.noticeBox}>{notice}</div>}

              <button
                type='button'
                className={styles.submitButton}
                disabled={loading}
                onClick={() => openPinStep(mode)}
              >
                {loading ? 'Procesando...' : mode === 'signup' ? 'Registrarme' : 'Entrar ahora'}
              </button>

              <p className={styles.phonePreview}>
                Formato guardado: {buildPhoneNumber(form.phoneCountry, form.phoneDigits || '0').replace(/0$/, '') || ''}
              </p>
            </div>
          </div>
        </section>
      </main>

      {pendingAction && (
        <SecurityPinModal
          mode={pendingAction}
          error={modalError}
          loading={loading}
          onClose={() => {
            if (loading) return
            setPendingAction(null)
            setModalError('')
          }}
          onSubmit={pin => void handlePinSubmit(pin)}
        />
      )}
    </>
  )
}
