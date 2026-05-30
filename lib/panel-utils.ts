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

function toDateOnlyString(date: Date) {
  return [
    String(date.getFullYear()).padStart(4, '0'),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-')
}

export function parseNullableDate(value: unknown) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return toDateOnlyString(value)
  }

  const raw = String(value || '').trim()
  if (!raw) return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw

  const slashMatch = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/)
  if (slashMatch) {
    const [, day, month, year] = slashMatch
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
  }

  const parsed = new Date(raw)
  return Number.isNaN(parsed.getTime()) ? null : toDateOnlyString(parsed)
}
