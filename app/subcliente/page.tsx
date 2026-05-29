'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import styles from './subcliente.module.css'

type FlowMode = 'lookup' | 'complete' | 'login'

type SubclientePayload = {
  createdByOwner?: boolean
  error?: string
  message?: string
  mode?: 'complete' | 'login'
  needsLogin?: boolean
  redirectPanel?: boolean
  session?: {
    access_token: string
    refresh_token: string
  }
  username?: string
}

const splitPin = (value: string) => value.replace(/\D/g, '').slice(0, 4).split('')

export default function SubclientePage() {
  const router = useRouter()
  const [mode, setMode] = useState<FlowMode>('lookup')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [phoneCountry, setPhoneCountry] = useState('PE')
  const [phoneDigits, setPhoneDigits] = useState('')
  const [securityPin, setSecurityPin] = useState('')
  const [createdByOwner, setCreatedByOwner] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const callSubcliente = async (body: Record<string, unknown>) => {
    const response = await fetch('/api/subcliente', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })

    const payload = (await response.json().catch(() => ({}))) as SubclientePayload
    if (!response.ok || payload.error) {
      throw new Error(payload.error || 'No se pudo continuar.')
    }

    return payload
  }

  const finishWithSession = async (payload: SubclientePayload) => {
    if (!payload.session?.access_token || !payload.session.refresh_token) {
      throw new Error('No se recibio la sesion.')
    }

    const sessionResp = await supabase.auth.setSession({
      access_token: payload.session.access_token,
      refresh_token: payload.session.refresh_token,
    })

    if (sessionResp.error) {
      throw new Error(sessionResp.error.message)
    }

    router.replace('/panel')
  }

  const lookupUser = async () => {
    setLoading(true)
    setError('')
    setNotice('')
    try {
      const payload = await callSubcliente({
        action: 'lookup',
        username,
      })
      setUsername(payload.username || username)
      setCreatedByOwner(Boolean(payload.createdByOwner))
      setMode(payload.mode === 'complete' ? 'complete' : 'login')
      setNotice(
        payload.mode === 'complete'
          ? 'Usuario encontrado. Termina el registro.'
          : 'Usuario listo. Inicia sesion.'
      )
    } catch (lookupError) {
      setError(lookupError instanceof Error ? lookupError.message : 'No se pudo buscar el usuario.')
    } finally {
      setLoading(false)
    }
  }

  const completeUser = async () => {
    setLoading(true)
    setError('')
    setNotice('')
    try {
      const payload = await callSubcliente({
        action: 'complete',
        username,
        password,
        phoneCountry,
        phoneDigits,
        securityPin,
      })

      if (payload.redirectPanel) {
        await finishWithSession(payload)
        return
      }

      setMode('login')
      setPassword('')
      setSecurityPin('')
      setNotice(payload.message || 'Registro completado. Ahora inicia sesion.')
    } catch (completeError) {
      setError(completeError instanceof Error ? completeError.message : 'No se pudo completar el registro.')
    } finally {
      setLoading(false)
    }
  }

  const loginUser = async () => {
    setLoading(true)
    setError('')
    setNotice('')
    try {
      const payload = await callSubcliente({
        action: 'login',
        username,
        password,
        securityPin,
      })
      await finishWithSession(payload)
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : 'No se pudo iniciar sesion.')
    } finally {
      setLoading(false)
    }
  }

  const updatePinDigit = (index: number, value: string) => {
    const digit = value.replace(/\D/g, '').slice(-1)
    const parts = splitPin(securityPin)
    parts[index] = digit
    setSecurityPin(parts.join(''))
  }

  return (
    <main className={styles.page}>
      <section className={styles.card}>
        <span className={styles.brand}>AlexCryx</span>
        <div className={styles.titleBlock}>
          <h1>Subcliente</h1>
          <p>
            Ingresa tu usuario. Si tu proveedor ya te creo, aqui terminas el registro o entras directo.
          </p>
        </div>

        {error && <div className={styles.alert}>{error}</div>}
        {notice && <div className={styles.success}>{notice}</div>}

        {mode === 'lookup' && (
          <div className={styles.form}>
            <label className={styles.fieldGroup}>
              <span>Nombre de usuario</span>
              <input
                className={styles.input}
                value={username}
                onChange={event => setUsername(event.target.value)}
                placeholder='tuusuario'
                autoFocus
              />
            </label>
            <button type='button' className={styles.button} onClick={() => void lookupUser()} disabled={loading}>
              Continuar
            </button>
          </div>
        )}

        {mode === 'complete' && (
          <div className={styles.form}>
            <div className={styles.hint}>
              Usuario: <strong>{username}</strong>
              {createdByOwner ? ' · al terminar entraras al panel.' : ' · al terminar te pedira iniciar sesion.'}
            </div>
            <label className={styles.fieldGroup}>
              <span>Numero de telefono</span>
              <div className={styles.phoneGrid}>
                <select
                  className={styles.select}
                  value={phoneCountry}
                  onChange={event => setPhoneCountry(event.target.value)}
                >
                  <option value='PE'>PE +51</option>
                  <option value='MX'>MX +52</option>
                  <option value='CO'>CO +57</option>
                  <option value='US'>US +1</option>
                  <option value='ES'>ES +34</option>
                </select>
                <input
                  className={styles.input}
                  inputMode='numeric'
                  value={phoneDigits}
                  onChange={event => setPhoneDigits(event.target.value.replace(/\D/g, ''))}
                  placeholder='Solo numeros'
                />
              </div>
            </label>
            <label className={styles.fieldGroup}>
              <span>Contrasena</span>
              <input
                className={styles.input}
                type='password'
                value={password}
                onChange={event => setPassword(event.target.value)}
                placeholder='Minimo 6 caracteres'
              />
            </label>
            <div className={styles.fieldGroup}>
              <span>Codigo de 4 digitos</span>
              <div className={styles.codeRow}>
                {[0, 1, 2, 3].map(index => (
                  <input
                    key={index}
                    className={styles.input}
                    inputMode='numeric'
                    maxLength={1}
                    value={splitPin(securityPin)[index] || ''}
                    onChange={event => updatePinDigit(index, event.target.value)}
                  />
                ))}
              </div>
            </div>
            <button type='button' className={styles.button} onClick={() => void completeUser()} disabled={loading}>
              Terminar registro
            </button>
            <button type='button' className={styles.ghostButton} onClick={() => setMode('lookup')}>
              Cambiar usuario
            </button>
          </div>
        )}

        {mode === 'login' && (
          <div className={styles.form}>
            <div className={styles.hint}>Usuario: <strong>{username}</strong></div>
            <label className={styles.fieldGroup}>
              <span>Contrasena</span>
              <input
                className={styles.input}
                type='password'
                value={password}
                onChange={event => setPassword(event.target.value)}
                placeholder='Tu contrasena'
              />
            </label>
            <div className={styles.fieldGroup}>
              <span>Codigo de 4 digitos</span>
              <div className={styles.codeRow}>
                {[0, 1, 2, 3].map(index => (
                  <input
                    key={index}
                    className={styles.input}
                    inputMode='numeric'
                    maxLength={1}
                    value={splitPin(securityPin)[index] || ''}
                    onChange={event => updatePinDigit(index, event.target.value)}
                  />
                ))}
              </div>
            </div>
            <button type='button' className={styles.button} onClick={() => void loginUser()} disabled={loading}>
              Entrar al panel
            </button>
            <button type='button' className={styles.ghostButton} onClick={() => setMode('lookup')}>
              Cambiar usuario
            </button>
          </div>
        )}
      </section>
    </main>
  )
}
