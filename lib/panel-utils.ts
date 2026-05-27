export function normalizeDataUrlImage(value: unknown) {
  const raw = String(value || '').trim()
  if (!raw) return null
  if (!raw.startsWith('data:image/')) {
    throw new Error('La imagen debe enviarse como data URL.')
  }
  return raw
}

export function parseMoney(value: unknown, fallback = 0) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

export function parseNullableDate(value: unknown) {
  const raw = String(value || '').trim()
  return raw || null
}
