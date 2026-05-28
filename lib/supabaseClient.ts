import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

export const hasSupabasePublicEnv = Boolean(supabaseUrl && supabaseAnonKey)

const fallbackSupabaseUrl = 'https://placeholder-project.supabase.co'
const fallbackSupabaseAnonKey =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.placeholder.placeholder'

const resolvedSupabaseUrl = supabaseUrl || fallbackSupabaseUrl
const resolvedSupabaseAnonKey = supabaseAnonKey || fallbackSupabaseAnonKey

export const supabase = createClient(resolvedSupabaseUrl, resolvedSupabaseAnonKey, {
  auth: {
    autoRefreshToken: hasSupabasePublicEnv,
    persistSession: hasSupabasePublicEnv,
  },
})
