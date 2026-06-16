'use client'

import { useEffect, useState } from 'react'

const clearBrowserState = () => {
  window.localStorage.clear()
  window.sessionStorage.clear()

  document.cookie.split(';').forEach(cookie => {
    const name = cookie.split('=')[0]?.trim()
    if (!name) return

    document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`
    document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; domain=${window.location.hostname}`
  })
}

export default function ClearCookiesPage() {
  const [done, setDone] = useState(false)

  useEffect(() => {
    clearBrowserState()
    setDone(true)
    const timeout = window.setTimeout(() => {
      window.location.replace('/')
    }, 700)

    return () => window.clearTimeout(timeout)
  }, [])

  return (
    <main
      style={{
        alignItems: 'center',
        background:
          'radial-gradient(circle at 20% 20%, rgba(255, 20, 35, 0.24), transparent 28%), linear-gradient(135deg, #050505, #180507)',
        color: '#fff',
        display: 'grid',
        fontFamily: 'serif',
        minHeight: '100vh',
        padding: 24,
        placeItems: 'center',
      }}
    >
      <section
        style={{
          background: 'rgba(255,255,255,0.04)',
          border: '1px solid rgba(255,255,255,0.12)',
          borderRadius: 28,
          boxShadow: '0 30px 80px rgba(0,0,0,0.35)',
          maxWidth: 460,
          padding: 28,
          textAlign: 'center',
          width: '100%',
        }}
      >
        <strong style={{ color: '#ff7b84', letterSpacing: '0.16em', textTransform: 'uppercase' }}>
          AlexCryx
        </strong>
        <h1 style={{ fontSize: 36, lineHeight: 1, margin: '14px 0 10px' }}>
          {done ? 'Sesion limpiada' : 'Limpiando sesion'}
        </h1>
        <p style={{ color: '#ead3d6', margin: 0 }}>
          Borrando cookies y cache local. Te enviaremos al inicio en un momento.
        </p>
      </section>
    </main>
  )
}
