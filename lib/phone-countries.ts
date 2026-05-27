import { getCountries, getCountryCallingCode, type CountryCode } from 'libphonenumber-js'

export type PhoneCountryOption = {
  code: CountryCode
  dialCode: string
  flag: string
  label: string
}

const DEFAULT_COUNTRY = 'PE'

const priorityCountries = ['PE', 'MX', 'CO', 'AR', 'CL', 'US', 'ES'] as const

const toFlagEmoji = (countryCode: string) =>
  countryCode
    .toUpperCase()
    .split('')
    .map(char => String.fromCodePoint(127397 + char.charCodeAt(0)))
    .join('')

const regionNames = new Intl.DisplayNames(['es'], { type: 'region' })

const allCountryOptions = getCountries()
  .map(country => ({
    code: country,
    dialCode: getCountryCallingCode(country),
    flag: toFlagEmoji(country),
    label: regionNames.of(country) || country,
  }))
  .sort((left, right) => left.label.localeCompare(right.label, 'es'))

const prioritySet = new Set<string>(priorityCountries)

export const DEFAULT_PHONE_COUNTRY = DEFAULT_COUNTRY as CountryCode

export const PHONE_COUNTRY_OPTIONS: PhoneCountryOption[] = [
  ...priorityCountries.map(code => allCountryOptions.find(option => option.code === code)).filter(Boolean),
  ...allCountryOptions.filter(option => !prioritySet.has(option.code)),
] as PhoneCountryOption[]
