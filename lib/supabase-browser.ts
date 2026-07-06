import { createBrowserClient } from '@supabase/ssr'

// Client Supabase per i Client Component (browser).
// Isolato da lib/supabase.ts perche' quello importa next/headers (solo server),
// che non puo' finire nel bundle client.
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}
