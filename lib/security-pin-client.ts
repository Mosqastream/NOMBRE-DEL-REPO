const PIN_PATTERN = /^\d{4}$/

export const normalizeSecurityPin = (value: string) => value.replace(/\D/g, '').slice(0, 4)

export const validateSecurityPin = (value: string) => {
  if (!PIN_PATTERN.test(value)) {
    return 'Ingresa un código de 4 dígitos.'
  }

  return ''
}
