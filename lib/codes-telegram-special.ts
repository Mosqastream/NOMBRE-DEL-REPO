export const SPECIAL_NETFLIX_RECIPIENTS = [
  'animespronet04@surfergo.com',
  'barry@tiendasec.cloud',
  'chispa023@tucinepro.com',
  'elevion_85@digitalstore.life',
  'rayo@digitalstore.life',
  'shiner03@tucinepro.com',
  'artemisa@digitalstore.life',
  'yemar_@tiendasec.cloud',
] as const

export type SpecialNetflixActionKey =
  | 'access-temporary-link'
  | 'update-household-link'
  | 'reset-password'
  | 'login-code'

export type SpecialNetflixAction = {
  key: SpecialNetflixActionKey
  label: string
  buttonNeedles: string[]
  helperText: string
}

export const SPECIAL_NETFLIX_ACTIONS: SpecialNetflixAction[] = [
  {
    key: 'access-temporary-link',
    label: 'Link Acceso Temporal',
    buttonNeedles: ['link acceso temporal'],
    helperText: 'Pide el ultimo enlace temporal del bot para este correo.',
  },
  {
    key: 'update-household-link',
    label: 'Link Actualizar Hogar',
    buttonNeedles: ['link actualizar hogar'],
    helperText: 'Pide el enlace de actualizar hogar y devuelve la respuesta cruda.',
  },
  {
    key: 'reset-password',
    label: 'Reset Password',
    buttonNeedles: ['reset password'],
    helperText: 'Ejecuta el flujo de reset password y devuelve el ultimo mensaje.',
  },
  {
    key: 'login-code',
    label: 'Cod. Inicio Sesion',
    buttonNeedles: ['cod. inicio sesion', 'cod inicio sesion'],
    helperText: 'Pide el codigo de inicio de sesion y muestra el ultimo mensaje recibido.',
  },
]

export const SPECIAL_NETFLIX_RECIPIENT_SET = new Set(
  SPECIAL_NETFLIX_RECIPIENTS.map(recipient => recipient.trim().toLowerCase())
)

export const normalizeSpecialRecipient = (value: string) => value.trim().toLowerCase()

export const isSpecialNetflixRecipient = (value: string) =>
  SPECIAL_NETFLIX_RECIPIENT_SET.has(normalizeSpecialRecipient(value))

export const normalizeTelegramButtonText = (value: string) =>
  value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()

export const getSpecialNetflixAction = (value: string | null | undefined) =>
  SPECIAL_NETFLIX_ACTIONS.find(action => action.key === value) ?? null
