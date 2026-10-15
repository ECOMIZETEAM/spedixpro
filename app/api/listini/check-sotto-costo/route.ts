import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { bloccaAgente } from '@/lib/agente'
import { gestisceLaRete } from '@/lib/ruoli'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { rilevaSottoCosto } from '@/lib/sotto-costo'
import { parseScaglioniSupp } from '@/lib/pricing'
import { chiaveServizioGiacenza } from '@/lib/sotto-costo-formule'

// CHECK SOTTO COSTO — quello che vendi ai tuoi clienti sotto quello che paghi tu.
//
// Non e' il "pavimento" (un minimo teorico, e oggi nessun contratto ce l'ha acceso): qui il
// confronto e' col TUO costo vero, cioe' il tuo listino corriere. Riga per riga: stessa zona,
// stessa fascia di peso, stesso supplemento. Se il cliente paga meno di te, quella riga ti fa
// perdere soldi a ogni spedizione — e finche' non la sistemi continua.
//
// La regola di chi fa cosa (Lorenzo, 30/09): la struttura e' nostra — che una destinazione sia
// prezzata nella zona giusta e non a tariffa Italia quando Italia non e'. I PREZZI ai clienti sono
// lavoro del master: qui glieli si mostra, e con "Adegua" li porta almeno al suo costo.
//
// Sola lettura. L'adeguamento e' nella POST.

export async function GET(_req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo').eq('id', user.id).single()
  const _bloccoAg = bloccaAgente(utente as any); if (_bloccoAg) return _bloccoAg
  if (!utente?.master_id || !gestisceLaRete(utente)) return NextResponse.json({ righe: [], totale: 0 })
  // La rilevazione sta in lib/sotto-costo.ts: ogni supplemento col calcolo con cui si addebita.
  const righe = await rilevaSottoCosto(createAdminSupabase(), utente.master_id)
  return NextResponse.json({
    righe: righe.slice(0, 2000),
    totale: righe.length,
    listiniCoinvolti: new Set(righe.map(r => r.listino_id)).size,
  })
}

// ADEGUA — ALZA il prezzo di vendita delle righe sotto costo.
//
// NON porta al costo: ALZA il prezzo ATTUALE dell'aumento scelto dal master, a VALORE FISSO (+0,50€)
// E/O PERCENTUALE (+10%), applicato al prezzo di ADESSO. Es. vendi a 2,90: +0,50€ → 3,40; +10% → 3,19.
// Con 0 e 0 non si alza nulla ("metto 0 = non la alzo"). Si rilegge il prezzo corrente, così due clic
// non si sommano a sorpresa su un valore vecchio.
// Supplementi (reso/assicurazione/contrassegno): l'aumento % alza sia il fisso sia la percentuale,
// l'aumento € solo il fisso (su una percentuale un importo in € non ha senso). Una riga che manca
// nel listino del cliente si crea, partendo da quello che il cliente paga oggi senza riga.
export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo').eq('id', user.id).single()
  const _bloccoAg = bloccaAgente(utente as any); if (_bloccoAg) return _bloccoAg
  if (!utente?.master_id || !gestisceLaRete(utente)) return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  const mio = utente.master_id
  const admin = createAdminSupabase()
  const body = await req.json().catch(() => ({} as any))
  const chiavi: string[] = Array.isArray(body?.chiavi) ? body.chiavi : []
  const marginePerc = Math.max(0, Number(body?.marginePerc) || 0)
  const margineFisso = Math.max(0, Number(body?.margineFisso) || 0)
  if (!chiavi.length) return NextResponse.json({ error: 'Nessuna riga selezionata' }, { status: 400 })
  // Nessun aumento scelto = niente da fare ("metto 0 = non la alzo").
  if (marginePerc === 0 && margineFisso === 0) return NextResponse.json({ error: 'Imposta un aumento (€ o %) maggiore di zero per alzare i prezzi.' }, { status: 400 })
  // ALZA il prezzo attuale: × (1 + X%) + Y€. alzaPerc solo ×(1+X%) (il fisso € non tocca una percentuale).
  const alza = (prezzo: number) => Math.round((prezzo * (1 + marginePerc / 100) + margineFisso) * 100) / 100
  const alzaPerc = (perc: number) => Math.round(perc * (1 + marginePerc / 100) * 100) / 100

  // Si rilegge la situazione ADESSO (non ci si fida di quello che aveva a video chi preme). Tutte le
  // righe, non le prime 2.000 che la GET manda alla pagina: "Adegua tutte" deve arrivare in fondo.
  const perChiave = new Map<string, any>((await rilevaSottoCosto(admin, mio)).map(r => [r.chiave, r]))

  // I LISTINI DEVONO ESSERE MIEI. Qui si scrive con la chiave di servizio, che salta le regole per
  // riga: l'appartenenza si ricontrolla a mano, come nelle altre porte.
  const { data: miei } = await admin.from('listini_clienti').select('id').eq('master_id', mio)
  const mieiIds = new Set((miei || []).map((l: any) => l.id))

  let fatte = 0, saltate = 0, invariate = 0
  for (const k of chiavi) {
    const r = perChiave.get(k)
    if (!r || !mieiIds.has(r.listino_id)) { saltate++; continue }
    if (r.tipo === 'fascia' && r.fascia_id) {
      // si alza il prezzo MOSTRATO (con fuel, quello che vede il master), poi si toglie il fuel per
      // salvarlo; si rilegge il prezzo di ADESSO così clic ripetuti non si sommano su un valore vecchio
      const { data: f } = await admin.from('listini_clienti_fasce').select('prezzo,fuel').eq('id', r.fascia_id).maybeSingle()
      const fuel = Number((f as any)?.fuel) || 0
      const attualeConFuel = Math.round((Number((f as any)?.prezzo) || 0) * (1 + fuel / 100) * 100) / 100
      const prezzoBase = Math.round((alza(attualeConFuel) / (1 + fuel / 100)) * 100) / 100
      // .select(): conta "alzata" SOLO se l'update ha toccato una riga (id ancora esistente); 0 righe
      // NON e' un errore per PostgREST → prima si contava "fatta" a vuoto (falso "adeguato").
      const { data: upd } = await admin.from('listini_clienti_fasce').update({ prezzo: prezzoBase }).eq('id', r.fascia_id).select('id')
      if (upd && upd.length) fatte++; else saltate++
    } else if (r.tipo === 'supplemento' && r.supplemento_id) {
      const { data: s } = await admin.from('listini_clienti_supplementi').select('id,tipo,valore,descrizione,nome').eq('id', r.supplemento_id).maybeSingle()
      if (!s) { saltate++; continue }
      let d: any = {}; try { d = JSON.parse((s as any).descrizione || '{}') || {} } catch { /* non JSON */ }
      let agg: any, prima: number, dopo: number, primaP = 0, dopoP = 0
      if (s.tipo === 'contrassegno' || s.tipo === 'assicurazione') {
        // Lo scaglione si addebita da `prezzo_fisso` del JSON (parseScaglioniSupp). Prima qui si
        // scrivevano `valore` e `prezzo`: l'addebito non li leggeva, e "adeguato" non cambiava niente.
        const sc = parseScaglioniSupp([s], s.tipo)[0]
        prima = sc.prezzo_fisso; dopo = alza(prima); primaP = sc.perc; dopoP = alzaPerc(primaP)
        d.prezzo_fisso = String(dopo); if (dopoP > 0) d.perc = String(dopoP)
        agg = { valore: dopo, descrizione: JSON.stringify(d) }
      } else if (['giacenza_apertura', 'sponda', 'ritiro'].includes(s.tipo)) {
        // un importo solo, nella colonna `valore`: la descrizione (soglia della sponda, % del ritiro) resta
        prima = Number(s.valore) || 0; dopo = alza(prima)
        agg = { valore: dopo }
      } else {
        // giacenze e accessori: fisso + % del nolo. L'accessorio si addebita dal `prezzo` del JSON se
        // c'e' (lib/cascata.ts, lib/prezzo-cliente.ts), la giacenza dalla colonna `valore`.
        prima = s.tipo === 'accessorio' ? (Number(d?.prezzo ?? s.valore ?? 0) || 0) : (Number(s.valore) || 0)
        dopo = alza(prima); primaP = Number(d?.perc) || 0; dopoP = alzaPerc(primaP)
        d.prezzo = dopo; d.perc = dopoP; if (d.nome == null) d.nome = s.nome
        agg = { valore: dopo, descrizione: JSON.stringify(d) }
      }
      // Una riga a 0 € con un aumento in % resta a 0: non e' "adeguata", va detto al master.
      if (dopo === prima && dopoP === primaP) { invariate++; continue }
      const { data: upd } = await admin.from('listini_clienti_supplementi').update(agg).eq('id', s.id).select('id')
      if (upd && upd.length) fatte++; else saltate++
    } else if (r.tipo === 'supplemento' && r.manca) {
      // RIGA ASSENTE nel listino del cliente: oggi il cliente paga il predefinito (zero, o il nolo
      // intero per il reso). Si alza quello, come una riga che c'e', e la si crea.
      const m = r.manca
      const dopo = alza(Number(m.valore) || 0), dopoP = alzaPerc(Number(m.perc) || 0)
      if (dopo === (Number(m.valore) || 0) && dopoP === (Number(m.perc) || 0)) { invariate++; continue }
      // Nel frattempo qualcuno puo' averla creata (un altro clic, l'editor): niente doppioni.
      const { data: esistenti } = await admin.from('listini_clienti_supplementi').select('nome')
        .eq('listino_id', r.listino_id).eq('corriere_id', r.corriere_id).eq('tipo', m.tipo)
      const stessa = (nome: string) => m.tipo !== 'giacenza'
        || (chiaveServizioGiacenza(m.nome) ? chiaveServizioGiacenza(nome) === chiaveServizioGiacenza(m.nome) : String(nome || '').toLowerCase().trim() === String(m.nome).toLowerCase().trim())
      if ((esistenti || []).some((x: any) => stessa(x.nome))) { saltate++; continue }
      const riga = m.tipo === 'giacenza'
        ? { tipo: 'giacenza', nome: m.nome, valore: dopo, tipo_calcolo: 'fisso', descrizione: JSON.stringify({ nome: m.nome, prezzo: dopo, perc: dopoP }) }
        : m.tipo === 'giacenza_apertura'
          ? { tipo: 'giacenza_apertura', nome: 'Apertura dossier giacenza', valore: dopo, tipo_calcolo: 'fisso' }
          : { tipo: 'sponda', nome: 'Sponda', valore: dopo, tipo_calcolo: 'per_kg', descrizione: JSON.stringify({ soglia_kg: m.soglia_kg }) }
      const { data: ins } = await admin.from('listini_clienti_supplementi').insert({ listino_id: r.listino_id, corriere_id: r.corriere_id, ...riga }).select('id')
      if (ins && ins.length) fatte++; else saltate++
    } else saltate++
  }
  return NextResponse.json({ ok: true, adeguate: fatte, saltate, invariate })
}
