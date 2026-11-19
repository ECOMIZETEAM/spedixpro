import { NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { bloccaAgente } from '@/lib/agente'
import { gestisceLaRete } from '@/lib/ruoli'
import { createAdminSupabase, createAdminSupabaseConMemoria } from '@/lib/supabase-admin'
import { controllaListiniClienti, type DaSistemare } from '@/lib/network-da-fare'

// IL RIQUADRO «COSA DEVI FARE» DI «DAL MIO NETWORK» (Lorenzo, 12/11/2026: «ogni master veda a schermo cosa deve fare»).
// Per le rettifiche ricevute ancora da decidere dice, raggruppato, cosa sistemare perche' «Carica» le possa girare:
//   - il listino di un MIO cliente che non arriva al peso ripesato, o non prezza la destinazione: si controlla ADESSO,
//     anche prima di premere «Carica», con lo stesso conto (lib/network-da-fare);
//   - gli altri motivi (listino di un sotto-master, misure mancanti, catena…) li ha scritti «Carica» sulla riga
//     (rettifiche.da_sistemare) e restano finche' la riga non passa.
// Ogni master vede solo le sue: le rettifiche che gli sono state addebitate (target_master_id = lui).
// Prende il posto di /api/network/listini-da-alzare, che guardava la fascia piu' alta di tutte le zone (Venezia/Laguna a
// 100 kg copriva Scifo Giuseppina Sandra ferma a 5 kg in zona Italia) e leggeva al massimo mille righe.
export const maxDuration = 60

const VUOTO = { azioni: [], righe: {}, pronte: 0, totaleRighe: 0, totaleEuro: 0 }

export async function GET() {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo').eq('id', user.id).single()
  const _bloccoAg = bloccaAgente(utente as any); if (_bloccoAg) return _bloccoAg
  if (!utente?.master_id || !gestisceLaRete(utente)) return NextResponse.json(VUOTO)
  const mio = utente.master_id
  const admin = createAdminSupabase()

  // 1) TUTTE le ricevute ancora da decidere, a pagine (erano mille al massimo). Il motivo scritto da «Carica» si legge
  //    se la colonna c'e'; senza (prima dello SQL) il riquadro funziona lo stesso, coi soli listini dei clienti.
  const leggi = async (colonne: string) => {
    const tutte: any[] = []
    for (let da = 0; ; da += 1000) {
      const { data, error } = await admin.from('rettifiche').select(colonne)
        .eq('target_master_id', mio).neq('master_id', mio).eq('confermata', true).is('propagazione', null)
        .order('id').range(da, da + 999)
      if (error) return { tutte, error }
      tutte.push(...(data || []))
      if (!data || data.length < 1000) break
    }
    return { tutte, error: null as any }
  }
  const BASE = 'id,spedizione_id,numero_spedizione,colli_ripesati,differenza,fuori_sagoma'
  let { tutte, error } = await leggi(BASE + ',da_sistemare')
  if (error) ({ tutte, error } = await leggi(BASE))
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!tutte.length) return NextResponse.json(VUOTO)

  // Quelle che hanno gia' una figlia sono girate (le segna la rotta delle ricevute): non sono da sistemare.
  const conFiglia = new Set<string>()
  const ids = tutte.map(r => r.id)
  for (let i = 0; i < ids.length; i += 300) {
    const { data } = await admin.from('rettifiche').select('origine_rettifica_id').in('origine_rettifica_id', ids.slice(i, i + 300))
    for (const f of (data || []) as any[]) if (f.origine_rettifica_id) conFiglia.add(f.origine_rettifica_id)
  }
  const righe = tutte.filter(r => !conFiglia.has(r.id))

  // 2) I listini dei miei clienti, adesso.
  let ora = new Map<string, DaSistemare>()
  try { ora = await controllaListiniClienti(createAdminSupabaseConMemoria(), mio, righe) }
  catch (e: any) { console.error('[NETWORK][DA-FARE]', e?.message) }

  // 3) Riga per riga: il controllo di adesso vince; altrimenti il motivo scritto da «Carica». Un motivo «listino del
  //    cliente» che adesso non si ritrova vuol dire che il listino e' stato sistemato: la riga e' pronta da ricaricare.
  const DEL_CLIENTE = new Set(['listino_corto', 'zona', 'senza_listino'])
  const euro = (r: any) => Math.max(0, Math.round((-Number(r.differenza || 0) + Number(r.fuori_sagoma || 0)) * 100) / 100)
  const perRiga: Record<string, string> = {}
  let pronte = 0
  const gruppi = new Map<string, any>()
  for (const r of righe) {
    let m = ora.get(r.id)
    const scritto: DaSistemare | null = r.da_sistemare || null
    if (!m && scritto) {
      if (scritto.cliente_id && DEL_CLIENTE.has(scritto.codice)) { pronte++; perRiga[r.id] = 'Listino sistemato: ora passa, ripremi «Carica»'; continue }
      m = scritto
    }
    if (!m) continue
    perRiga[r.id] = m.breve || m.testo
    const k = [m.codice, m.cliente_id || m.master_id || m.chi || '', m.contratto || '', m.zona || ''].join('|')
    const g = gruppi.get(k) || { codice: m.codice, chi: m.chi || null, contratto: m.contratto || null, zona: m.zona || null,
      listino_id: m.listino_id || null, cliente_id: m.cliente_id || null, arriva_a: m.arriva_a ?? null, serve: 0,
      testo: m.testo, righe: 0, euro: 0, esempi: [] as string[] }
    g.righe++
    g.euro = Math.round((g.euro + euro(r)) * 100) / 100
    g.serve = Math.max(g.serve, Number(m.serve) || 0)
    if (g.esempi.length < 3) g.esempi.push(r.numero_spedizione)
    gruppi.set(k, g)
  }
  const kg = (x: number) => (Math.round(x * 100) / 100).toLocaleString('it-IT')
  const azioni = [...gruppi.values()].map(g => {
    // Col listino corto la frase dice il peso che serve a TUTTO il gruppo: il pacco piu' pesante.
    if (g.codice === 'listino_corto' && g.arriva_a != null && g.serve > 0) {
      g.testo = `Alza il listino di ${g.chi} su ${g.contratto}${g.zona ? ` (zona ${g.zona})` : ''}: oggi arriva a ${kg(g.arriva_a)} kg, serve almeno ${Math.ceil(g.serve - 1e-9)} kg. Poi ripremi «Carica».`
    }
    // Il listino di un mio cliente si apre da qui; quello di un sotto-master si sistema dalla sua scheda.
    g.link = g.listino_id && g.cliente_id && DEL_CLIENTE.has(g.codice) ? `/dashboard/listini/clienti/${g.listino_id}` : null
    return g
  }).sort((a, b) => b.euro - a.euro)

  return NextResponse.json({
    azioni,
    righe: perRiga,
    pronte,
    totaleRighe: azioni.reduce((a, g) => a + g.righe, 0),
    totaleEuro: Math.round(azioni.reduce((a, g) => a + g.euro, 0) * 100) / 100,
  })
}
