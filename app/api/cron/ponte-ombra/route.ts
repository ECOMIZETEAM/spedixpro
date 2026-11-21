import { NextRequest, NextResponse } from 'next/server'
import { bloccaCronNonAutorizzato } from '@/lib/cron-auth'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { confrontaInOmbra, COLONNE_ORIGINE, type EsitoOmbra } from '@/lib/ponte-ombra'
import { provaScritturaInOmbra, type EsitoScrittura } from '@/lib/ponte-ombra-scrittura'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

// IL PONTE UNICO IN OMBRA, OGNI DIECI MINUTI (fase 2 di PONTE-UNICO.md).
//
// Prende i condivisi nati nell'ultima ora con la staffetta (finita da almeno qualche minuto), rifa' per ognuno il
// lavoro di tutta la fila col ponte unico senza scrivere niente, e annota in `ponte_ombra` se e' venuto uguale a
// quello che la staffetta ha scritto davvero: gambe, conti d'ingrosso, prezzi, ogni movimento. Una riga per
// condiviso: quelli gia' controllati non si rifanno, e un giro che non finisce lascia il resto al giro dopo.
//
// Non sta nella creazione apposta: le spedizioni vere non aspettano niente e non leggono una riga in piu'. Se
// questo giro si ferma o sbaglia, l'unico effetto e' un buco nel registro.
//
// Interruttori (variabili su Vercel): PONTE_OMBRA=spento lo ferma; PONTE_OMBRA_CONTRATTI sceglie i contratti
// (nomi separati da virgola, predefinito SDA EXPRESS L, il primo deciso da Lorenzo il 20/11/2026).
//
// FASE 3: su ogni condiviso controllato si prova anche la SCRITTURA UNICA a vuoto (lib/ponte-ombra-scrittura): il piano
// del ponte unico scritto davvero nel database e annullato, confrontato campo per campo con le righe e i movimenti della
// staffetta. Le sue differenze finiscono nella stessa riga del registro, con «scrittura:» davanti. PONTE_OMBRA_SCRITTURA=
// spento la ferma; finche' le funzioni del database (scripts/ponte-unico-scrittura.sql) non ci sono, si salta da sola.

const FINESTRA_MIN = 60          // quanto indietro si guarda
const ATTESA_MIN = 4             // la staffetta deve aver finito: righe e addebiti di tutti i livelli scritti
const PER_GIRO = 150             // tetto di condivisi per giro
const INSIEME = 4                // condivisi controllati in parallelo: letture leggere, ma non tutte insieme
const TEMPO_MS = 230_000         // oltre, si chiude il giro e si lascia il resto al prossimo

export async function GET(req: NextRequest) {
  const _b = bloccaCronNonAutorizzato(req); if (_b) return _b
  if (process.env.PONTE_OMBRA === 'spento') return NextResponse.json({ spento: true })
  const t0 = Date.now()
  const admin = createAdminSupabase()
  const contratti = String(process.env.PONTE_OMBRA_CONTRATTI || 'SDA EXPRESS L').split(',').map(s => s.trim()).filter(Boolean)

  // I ponti di quei contratti (il contratto dell'origine e' un ponte: tipo moovexpress) e i conti d'ingrosso,
  // per riconoscere le righe d'origine fra le gambe che hanno lo stesso contratto.
  const nomePonte = new Map<string, string>()
  for (const nome of contratti) {
    const { data, error } = await admin.from('corrieri').select('id,nome_contratto').eq('tipo', 'moovexpress').ilike('nome_contratto', nome)
    if (error) return NextResponse.json({ error: 'corrieri: ' + error.message }, { status: 500 })
    for (const c of data || []) nomePonte.set((c as any).id, nome)
  }
  if (!nomePonte.size) return NextResponse.json({ controllati: 0, motivo: 'nessun ponte per ' + contratti.join(', ') })
  const { data: led, error: eLed } = await admin.from('clienti').select('id').eq('ledger', true)
  if (eLed) return NextResponse.json({ error: 'clienti: ' + eLed.message }, { status: 500 })
  const ledger = new Set((led || []).map((c: any) => c.id))

  const { data: righe, error: eRighe } = await admin.from('spedizioni').select(COLONNE_ORIGINE)
    .in('corriere_id', [...nomePonte.keys()])
    .gte('created_at', new Date(t0 - FINESTRA_MIN * 60e3).toISOString())
    .lt('created_at', new Date(t0 - ATTESA_MIN * 60e3).toISOString())
    .order('created_at').order('id').limit(1000)
  if (eRighe) return NextResponse.json({ error: 'spedizioni: ' + eRighe.message }, { status: 500 })
  const origini = (righe || []).filter((r: any) => !ledger.has(r.cliente_id) && r.tracking_number)

  const gia = new Set<string>()
  for (let i = 0; i < origini.length; i += 200) {
    const { data, error } = await admin.from('ponte_ombra').select('spedizione_origine_id')
      .in('spedizione_origine_id', origini.slice(i, i + 200).map((o: any) => o.id))
    if (error) return NextResponse.json({ error: 'ponte_ombra: ' + error.message }, { status: 500 })
    for (const r of data || []) gia.add((r as any).spedizione_origine_id)
  }
  const daFare = origini.filter((o: any) => !gia.has(o.id)).slice(0, PER_GIRO)

  const esiti: EsitoOmbra[] = []
  const scrittura = process.env.PONTE_OMBRA_SCRITTURA !== 'spento'
  let scritturaAssente = false
  // La prova della scrittura nella riga del registro: le sue differenze con «scrittura:» davanti, il suo esito che
  // peggiora quello della riga, i suoi numeri nel dettaglio.
  const conScrittura = (e: EsitoOmbra, s: EsitoScrittura | null): EsitoOmbra => {
    if (!s) return e
    if (s.esito === 'saltata') return { ...e, dettaglio: { ...(e.dettaglio || {}), scrittura: 'saltata: ' + (s.differenze[0]?.cosa || '') } }
    if (s.esito === 'errore' && s.differenze.some(d => /Could not find the function|does not exist/i.test(String(d.vero || '')))) {
      scritturaAssente = true
      return { ...e, dettaglio: { ...(e.dettaglio || {}), scrittura: 'funzioni non installate' } }
    }
    const peggiore = e.esito === 'errore' || s.esito === 'errore' ? 'errore' : e.esito === 'diverso' || s.esito === 'diverso' ? 'diverso' : 'uguale'
    return {
      ...e, esito: peggiore,
      differenze: [...e.differenze, ...s.differenze.slice(0, 40).map(d => ({ ...d, cosa: 'scrittura: ' + d.cosa }))],
      dettaglio: { ...(e.dettaglio || {}), scrittura: { esito: s.esito, ms: s.ms, righe: s.righe, movimenti: s.movimenti, differenze: s.differenze.length } },
    }
  }
  for (let i = 0; i < daFare.length && Date.now() - t0 < TEMPO_MS; i += INSIEME) {
    const blocco = await Promise.all(daFare.slice(i, i + INSIEME).map(async (o: any) => {
      const nome = nomePonte.get(o.corriere_id)!
      const [e, s] = await Promise.all([
        confrontaInOmbra(admin, o, nome),
        scrittura && !scritturaAssente ? provaScritturaInOmbra(admin, o, nome) : Promise.resolve(null),
      ])
      return conScrittura(e, s)
    }))
    esiti.push(...blocco)
    const { error } = await admin.from('ponte_ombra').upsert(blocco, { onConflict: 'spedizione_origine_id', ignoreDuplicates: true })
    if (error) { console.error('[OMBRA] registro non scritto:', error.message); break }
  }

  const conta = { uguale: 0, diverso: 0, errore: 0 }
  for (const e of esiti) conta[e.esito]++
  const ms = esiti.map(e => e.ms_ombra).filter((x): x is number => x != null).sort((a, b) => a - b)
  const riepilogo = {
    trovati: origini.length, gia_fatti: gia.size, controllati: esiti.length, ...conta,
    ms_ombra_mediana: ms.length ? ms[Math.floor(ms.length / 2)] : null, ms_ombra_max: ms.at(-1) ?? null,
    ms_giro: Date.now() - t0,
  }
  console.log('[OMBRA]', JSON.stringify(riepilogo))
  for (const e of esiti.filter(e => e.esito !== 'uguale').slice(0, 5)) {
    console.error('[OMBRA][DIFFERENZA]', e.tracking, e.esito, JSON.stringify(e.differenze).slice(0, 800))
  }
  return NextResponse.json(riepilogo)
}
