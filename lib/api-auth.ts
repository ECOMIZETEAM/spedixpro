import { createAdminSupabase } from '@/lib/supabase-admin'

export type ApiContext = {
  clienteId: string
  masterId: string
  corriereId: string
  keyId: string
}

// Autentica una richiesta API pubblica tramite header Authorization: Bearer <api_key>.
// La chiave è PER CONTRATTO -> risolve cliente + master + corriere (contratto).
export async function autenticaApiKey(req: Request): Promise<ApiContext | null> {
  const auth = req.headers.get('authorization') || req.headers.get('Authorization') || ''
  const token = auth.replace(/^Bearer\s+/i, '').trim()
  if (!token) return null
  const admin = createAdminSupabase()
  const { data } = await admin
    .from('api_keys')
    .select('id,cliente_id,master_id,corriere_id,attivo')
    .eq('chiave', token)
    .maybeSingle()
  if (!data || data.attivo === false) return null
  // aggiorna last_used_at senza bloccare la risposta
  admin.from('api_keys').update({ last_used_at: new Date().toISOString() }).eq('id', data.id).then(() => {}, () => {})
  return { clienteId: data.cliente_id, masterId: data.master_id, corriereId: data.corriere_id, keyId: data.id }
}

// Genera una chiave API leggibile e sicura.
export function generaApiKey(): string {
  const bytes = new Uint8Array(24)
  globalThis.crypto.getRandomValues(bytes)
  const hex = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')
  return `mvx_live_${hex}`
}
