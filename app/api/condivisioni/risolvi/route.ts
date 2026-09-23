import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { getPermessiUtente } from '@/lib/permessi'

/* Risolve un CODICE di condivisione nel solo NOME del master, per confermare a chi condivide che ha
 * preso l'azienda giusta. Non espone MAI un elenco: si risolve solo un codice che già si possiede.
 *
 * Freno anti-enumerazione: i codici sono a 64 bit (non si tirano a indovinare), ma per non farne
 * un oracolo di scansione si limita il ritmo per master. Riservato allo staff master (come tutto il resto).
 */

const tentativi = new Map<string, number[]>()
const FINESTRA = 60 * 1000
const MAX = 20
function troppi(chiave: string): boolean {
  const ora = Date.now()
  const p = (tentativi.get(chiave) || []).filter(t => ora - t < FINESTRA)
  p.push(ora); tentativi.set(chiave, p)
  if (tentativi.size > 5000) for (const [k, v] of tentativi) if (!v.some(t => ora - t < FINESTRA)) tentativi.delete(k)
  return p.length > MAX
}

export async function POST(req: NextRequest) {
  const perm = await getPermessiUtente()
  if (!perm?.masterId || !perm.isFull) return NextResponse.json({ error: 'Riservato al master' }, { status: 403 })
  if (troppi(perm.masterId)) return NextResponse.json({ error: 'Troppi tentativi, riprova fra un minuto.' }, { status: 429 })

  const corpo = await req.json().catch(() => ({} as any))
  const codice = String(corpo?.codice || '').trim().toUpperCase()
  if (!codice) return NextResponse.json({ error: 'Serve il codice.' }, { status: 400 })

  const admin = createAdminSupabase()
  const { data: m } = await admin.from('masters').select('id,nome').eq('codice_condivisione', codice).maybeSingle()
  if (!m) return NextResponse.json({ trovato: false }, { status: 404 })
  if (m.id === perm.masterId) return NextResponse.json({ trovato: false, tu: true }, { status: 200 })
  // Solo il nome: mai id o altri dati.
  return NextResponse.json({ trovato: true, nome: m.nome })
}
