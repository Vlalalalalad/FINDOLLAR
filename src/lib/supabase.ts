import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string

if (!supabaseUrl || !supabaseAnonKey) {
  // eslint-disable-next-line no-console
  console.warn(
    'Не задані VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY. Створи .env.local за прикладом .env.example.'
  )
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

/** Sign in/validate another account without disturbing the active client. */
export const createAccountAuthClient = () => createClient(supabaseUrl, supabaseAnonKey, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: 'findollar-account-validation' },
})
