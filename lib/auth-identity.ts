import { getCountryCallingCode, type CountryCode } from 'libphonenumber-js'

const AUTH_USERNAME_DOMAIN = 'clientes.local'
const USERNAME_PATTERN = /^[a-z0-9](?:[a-z0-9._-]{1,28}[a-z0-9])?$/
const COUNTRY_CODE_PATTERN = /^[A-Z]{2}$/
const DEFAULT_PHONE_COUNTRY = 'PE'

export const normalizeUsername = (value: string) => value.trim().toLowerCase()

export const normalizePhoneDigits = (value: string) => value.replace(/\D/g, '')

export const normalizePhoneCountry = (value: string) => {
  const normalized = value.trim().toUpperCase()
  return COUNTRY_CODE_PATTERN.test(normalized) ? normalized : DEFAULT_PHONE_COUNTRY
}

export const buildPhoneNumber = (country: string, digits: string) => {
  const normalizedCountry = normalizePhoneCountry(country) as CountryCode
  const normalizedDigits = normalizePhoneDigits(digits)
  const dialCode = getCountryCallingCode(normalizedCountry)
  return `+${dialCode}${normalizedDigits}`
}

export const normalizeTelegram = (value: string) => {
  const cleaned = value.trim().replace(/^@+/, '')
  return cleaned ? `@${cleaned}` : ''
}

export const usernameToAuthEmail = (username: string) =>
  `${normalizeUsername(username)}@${AUTH_USERNAME_DOMAIN}`

export const validateUsername = (value: string) => {
  const normalized = normalizeUsername(value)

  if (!normalized) {
    return 'Ingresa tu nombre de usuario.'
  }

  if (!USERNAME_PATTERN.test(normalized)) {
    return 'Usa 3 a 30 caracteres: letras, números, punto, guion o guion bajo.'
  }

  return ''
}

export const validatePassword = (value: string) => {
  if (!value.trim()) {
    return 'Ingresa tu contraseña.'
  }

  if (value.length < 6) {
    return 'La contraseña debe tener al menos 6 caracteres.'
  }

  return ''
}

export const validatePhone = (country: string, digits: string) => {
  const normalizedCountry = normalizePhoneCountry(country)
  const normalizedDigits = normalizePhoneDigits(digits)

  if (!normalizedCountry) {
    return 'Selecciona un país.'
  }

  if (!normalizedDigits) {
    return 'Ingresa tu número de teléfono.'
  }

  if (normalizedDigits.length < 6) {
    return 'Ingresa un número de teléfono válido.'
  }

  return ''
}

export const validateTelegram = (value: string) => {
  const normalized = normalizeTelegram(value)

  if (!normalized) {
    return ''
  }

  if (normalized.length < 4) {
    return 'El usuario de Telegram no parece válido.'
  }

  return ''
}
