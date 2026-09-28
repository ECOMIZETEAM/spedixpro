// CAP che hanno una zona SPECIALE (disagiata/isole/periferiche/esclusive) con riga a CAP esatto.
//
// Serve al blocco città↔CAP (vedi lib/valida-citta e app/api/spedizioni/crea): su questi CAP una città
// scritta male fa cadere la zona speciale sul jolly "Italia" → venduto pianura, pagato disagiata. Su un
// CAP NORMALE, invece, una città diversa prezza comunque Italia (giusto): lì non si blocca nulla, così
// si evita di fermare frazioni valide e abbreviazioni (misurato: blocco secco 2,2% → mirato 0,45%).
//
// Il set si carica dal DB una volta e si rinfresca ogni 10 minuti (le zone cambiano di rado). Fallback
// sicuro: se il caricamento fallisce, torna `false` (non blocca) — meglio non bloccare che bloccare a caso.
import { createAdminSupabase } from '@/lib/supabase-admin'

let cache: Set<string> | null = null
let caricatoA = 0
let inCorso: Promise<Set<string>> | null = null
const TTL = 10 * 60 * 1000

const PATTERN = ['%disagiat%', '%isole%', '%isola%', '%perifer%', '%livigno%', '%venezia%', '%laguna%', '%scs%']

async function carica(): Promise<Set<string>> {
  const admin = createAdminSupabase()
  const set = new Set<string>()
  const { data: zone } = await admin.from('zone').select('id').or(PATTERN.map(p => `nome.ilike.${p}`).join(','))
  const ids = (zone || []).map((z: any) => z.id)
  for (let i = 0; i < ids.length; i += 200) {
    const { data: righe } = await admin.from('zone_cap').select('cap').in('zona_id', ids.slice(i, i + 200)).neq('cap', '*').not('cap', 'is', null)
    for (const r of (righe || []) as any[]) if (r.cap) set.add(String(r.cap).trim())
  }
  return set
}

// true se quel CAP ha una zona speciale (→ la città giusta conta). Non blocca mai su errore di lettura.
export async function capHaZonaSpeciale(cap: string | null | undefined): Promise<boolean> {
  const c = (cap || '').trim()
  if (!/^\d{5}$/.test(c)) return false
  const ora = Date.now()
  if (!cache || ora - caricatoA > TTL) {
    if (!inCorso) inCorso = carica().then(s => { cache = s; caricatoA = Date.now(); inCorso = null; return s }).catch(() => { inCorso = null; return cache || new Set<string>() })
    try { await inCorso } catch { /* fallback sotto */ }
  }
  return (cache || new Set()).has(c)
}
