export type CodePlatformKey = 'netflix' | 'disney' | 'hbo'
export type CodePlatformMatch = CodePlatformKey | 'other'

export type CodePlatformMeta = {
  key: CodePlatformKey
  label: string
  hint: string
  summary: string
  accentClass: string
  icon: string
}

export const CODE_PLATFORM_META: Record<CodePlatformKey, CodePlatformMeta> = {
  netflix: {
    key: 'netflix',
    label: 'Netflix',
    hint: 'Correos oficiales',
    summary: 'Accede a la mayor biblioteca de series y peliculas del mundo.',
    accentClass: 'netflix',
    icon: 'N',
  },
  disney: {
    key: 'disney',
    label: 'Disney+',
    hint: 'Recuperacion y accesos',
    summary: 'Accede a Disney, Marvel, Star Wars, Pixar y National Geographic.',
    accentClass: 'disney',
    icon: 'D',
  },
  hbo: {
    key: 'hbo',
    label: 'HBO Max',
    hint: 'Mensajes recientes',
    summary: 'Consulta accesos y mensajes recientes de HBO Max.',
    accentClass: 'hbo',
    icon: 'H',
  },
}

export const CODE_PLATFORM_ORDER: CodePlatformKey[] = ['netflix', 'disney', 'hbo']

export function getCodePlatformLabel(platform: CodePlatformMatch) {
  if (platform === 'other') return 'Otros'
  return CODE_PLATFORM_META[platform].label
}

export function detectCodePlatform(params: {
  from?: string | null
  subject?: string | null
  bodyText?: string | null
}): CodePlatformMatch {
  const haystack = [params.from, params.subject, params.bodyText]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()

  if (haystack.includes('netflix')) return 'netflix'
  if (haystack.includes('disney')) return 'disney'
  if (haystack.includes('hbo') || haystack.includes('max')) return 'hbo'
  return 'other'
}
