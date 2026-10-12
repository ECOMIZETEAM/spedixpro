import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { bloccaAgente } from '@/lib/agente'
import { gestisceLaRete } from '@/lib/ruoli'
import { createAdminSupabase } from '@/lib/supabase-admin'

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

type Riga = {
  chiave: string
  listino_id: string; listino_nome: string; clienti: string[]
  corriere: string; zona: string
  tipo: 'fascia' | 'supplemento'
  descrizione: string
  prezzo_cliente: number; costo_tuo: number; differenza: number
  costo_perc?: number        // supplementi: la percentuale che paghi tu (per adeguare anche la %)
  corriere_id?: string       // per il deep-link all'editor sul corriere giusto (?corriere=)
  fascia_id?: string; supplemento_id?: string
}

export async function GET(_req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo').eq('id', user.id).single()
  const _bloccoAg = bloccaAgente(utente as any); if (_bloccoAg) return _bloccoAg
  if (!utente?.master_id || !gestisceLaRete(utente)) return NextResponse.json({ righe: [], totale: 0 })
  const mio = utente.master_id
  const admin = createAdminSupabase()

  // I MIEI COSTI: listino corriere del master, per corriere+zona+fascia. Col fuel dentro, perche'
  // e' quello che pago davvero.
  const { data: mieiCorrieri } = await admin.from('corrieri').select('id,nome_contratto').eq('master_id', mio)
  const corrIds = (mieiCorrieri || []).map((c: any) => c.id)
  if (!corrIds.length) return NextResponse.json({ righe: [], totale: 0 })
  const nomeCorr = new Map<string, string>((mieiCorrieri || []).map((c: any) => [c.id, c.nome_contratto || 'Contratto']))

  const { data: zone } = await admin.from('zone').select('id,nome,corriere_id').in('corriere_id', corrIds)
  const nomeZona = new Map<string, string>((zone || []).map((z: any) => [z.id, z.nome || 'Zona']))

  const conFuel = (prezzo: any, fuel: any) => {
    const p = Number(prezzo) || 0, f = Number(fuel) || 0
    return Math.round(p * (1 + f / 100) * 100) / 100
  }

  const costoFascia = new Map<string, number>()   // corriere|zona|peso_max -> costo mio
  for (let i = 0; i < corrIds.length; i += 50) {
    for (let da = 0; ; da += 1000) {
      const { data } = await admin.from('listini_corrieri_fasce')
        .select('corriere_id,zona_id,peso_max,prezzo,fuel').in('corriere_id', corrIds.slice(i, i + 50))
        .order('id').range(da, da + 999)
      for (const f of (data || [])) costoFascia.set(`${(f as any).corriere_id}|${(f as any).zona_id}|${(f as any).peso_max}`, conFuel((f as any).prezzo, (f as any).fuel))
      if (!data || data.length < 1000) break
    }
  }
  const costoSupp = new Map<string, { valore: number; perc: number }>()   // corriere|tipo|nome -> quanto pago
  for (let i = 0; i < corrIds.length; i += 50) {
    for (let da = 0; ; da += 1000) {
      const { data } = await admin.from('listini_corrieri_supplementi')
        .select('corriere_id,tipo,nome,valore,descrizione').in('corriere_id', corrIds.slice(i, i + 50))
        .order('id').range(da, da + 999)
      for (const s of (data || [])) {
        let perc = 0; try { perc = Number(JSON.parse((s as any).descrizione || '{}')?.perc) || 0 } catch { /* non JSON */ }
        costoSupp.set(`${(s as any).corriere_id}|${(s as any).tipo}|${String((s as any).nome || '').toLowerCase().trim()}`, { valore: Number((s as any).valore) || 0, perc })
      }
      if (!data || data.length < 1000) break
    }
  }

  // I MIEI LISTINI CLIENTE (solo quelli assegnati a clienti veri: quelli dei sotto-master sono
  // all'ingrosso e li governa un'altra logica).
  const { data: listini } = await admin.from('listini_clienti').select('id,nome').eq('master_id', mio)
  const nomeListino = new Map<string, string>((listini || []).map((l: any) => [l.id, l.nome || 'Listino']))
  const ids = [...nomeListino.keys()]
  if (!ids.length) return NextResponse.json({ righe: [], totale: 0 })
  const clientiDi = new Map<string, string[]>()
  for (let i = 0; i < ids.length; i += 100) {
    const { data } = await admin.from('clienti').select('ragione_sociale,listino_cliente_id').in('listino_cliente_id', ids.slice(i, i + 100))
    for (const c of (data || [])) {
      const k = (c as any).listino_cliente_id
      if (!clientiDi.has(k)) clientiDi.set(k, [])
      clientiDi.get(k)!.push((c as any).ragione_sociale || '—')
    }
  }

  const righe: Riga[] = []
  // ── FASCE: stessa zona, stessa fascia di peso ──
  for (let i = 0; i < ids.length; i += 50) {
    for (let da = 0; ; da += 1000) {
      const { data } = await admin.from('listini_clienti_fasce')
        .select('id,listino_id,corriere_id,zona_id,peso_max,prezzo,fuel').in('listino_id', ids.slice(i, i + 50))
        .order('id').range(da, da + 999)
      for (const f of (data || [])) {
        const mioCosto = costoFascia.get(`${(f as any).corriere_id}|${(f as any).zona_id}|${(f as any).peso_max}`)
        if (mioCosto == null) continue          // fascia che non ho: non ho un costo da confrontare
        const prezzo = conFuel((f as any).prezzo, (f as any).fuel)
        if (prezzo >= mioCosto - 0.005) continue
        righe.push({
          chiave: `f:${(f as any).id}`, fascia_id: (f as any).id, corriere_id: (f as any).corriere_id,
          listino_id: (f as any).listino_id, listino_nome: nomeListino.get((f as any).listino_id) || 'Listino',
          clienti: clientiDi.get((f as any).listino_id) || [],
          corriere: nomeCorr.get((f as any).corriere_id) || '—', zona: nomeZona.get((f as any).zona_id) || '—',
          tipo: 'fascia', descrizione: `fino a ${(f as any).peso_max} kg`,
          prezzo_cliente: prezzo, costo_tuo: mioCosto, differenza: Math.round((prezzo - mioCosto) * 100) / 100,
        })
      }
      if (!data || data.length < 1000) break
    }
  }
  // ── SUPPLEMENTI: reso, assicurazione, contrassegno, giacenza… stesso nome, stesso contratto ──
  for (let i = 0; i < ids.length; i += 50) {
    for (let da = 0; ; da += 1000) {
      const { data } = await admin.from('listini_clienti_supplementi')
        .select('id,listino_id,corriere_id,tipo,nome,valore,descrizione').in('listino_id', ids.slice(i, i + 50))
        .order('id').range(da, da + 999)
      for (const s of (data || [])) {
        const mioS = costoSupp.get(`${(s as any).corriere_id}|${(s as any).tipo}|${String((s as any).nome || '').toLowerCase().trim()}`)
        if (!mioS) continue
        let perc = 0; try { perc = Number(JSON.parse((s as any).descrizione || '{}')?.perc) || 0 } catch { /* non JSON */ }
        const val = Number((s as any).valore) || 0
        // sotto costo se il fisso E la percentuale non arrivano a quello che pago io
        const sottoFisso = val < mioS.valore - 0.005
        const sottoPerc = perc < mioS.perc - 0.005
        if (!sottoFisso && !sottoPerc) continue
        righe.push({
          chiave: `s:${(s as any).id}`, supplemento_id: (s as any).id, corriere_id: (s as any).corriere_id,
          listino_id: (s as any).listino_id, listino_nome: nomeListino.get((s as any).listino_id) || 'Listino',
          clienti: clientiDi.get((s as any).listino_id) || [],
          corriere: nomeCorr.get((s as any).corriere_id) || '—', zona: (s as any).tipo,
          tipo: 'supplemento',
          descrizione: `${(s as any).nome}${sottoPerc ? ` (tu ${mioS.perc}%, lui ${perc}%)` : ''}`,
          prezzo_cliente: val, costo_tuo: mioS.valore, costo_perc: mioS.perc, differenza: Math.round((val - mioS.valore) * 100) / 100,
        })
      }
      if (!data || data.length < 1000) break
    }
  }
  righe.sort((a, b) => a.differenza - b.differenza)
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
// l'aumento € solo il fisso (su una percentuale un importo in € non ha senso).
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

  // Si rilegge la situazione ADESSO (non ci si fida di quello che aveva a video chi preme).
  const stato = await GET(req as any)
  const dati: any = await stato.json()
  const perChiave = new Map<string, any>((dati?.righe || []).map((r: any) => [r.chiave, r]))

  // I LISTINI DEVONO ESSERE MIEI. Qui si scrive con la chiave di servizio, che salta le regole per
  // riga: l'appartenenza si ricontrolla a mano, come nelle altre porte.
  const { data: miei } = await admin.from('listini_clienti').select('id').eq('master_id', mio)
  const mieiIds = new Set((miei || []).map((l: any) => l.id))

  let fatte = 0, saltate = 0
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
      // valore e percentuale stanno nel JSON `descrizione` (letto dal pannello) + la colonna `valore`.
      // L'aumento % alza entrambi; l'aumento € solo il fisso.
      const { data: s } = await admin.from('listini_clienti_supplementi').select('valore,descrizione,nome').eq('id', r.supplemento_id).maybeSingle()
      let d: any = {}; try { d = JSON.parse((s as any)?.descrizione || '{}') } catch { /* non JSON */ }
      const newVal = alza(Number((s as any)?.valore) || 0)
      const newPerc = alzaPerc(Number(d?.perc) || 0)
      d.prezzo = newVal; d.perc = newPerc; if (d.nome == null) d.nome = (s as any)?.nome
      const { data: upd } = await admin.from('listini_clienti_supplementi').update({ valore: newVal, descrizione: JSON.stringify(d) }).eq('id', r.supplemento_id).select('id')
      if (upd && upd.length) fatte++; else saltate++
    } else saltate++
  }
  return NextResponse.json({ ok: true, adeguate: fatte, saltate })
}
