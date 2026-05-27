import type { ReactNode } from 'react'
import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'AlexCryx',
  description: 'Administrador premium para clientes y cuentas del panel AlexCryx.',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: ReactNode
}>) {
  return (
    <html lang='es'>
      <body>{children}</body>
    </html>
  )
}
