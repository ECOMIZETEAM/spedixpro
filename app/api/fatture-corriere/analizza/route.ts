import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { bloccaAgente } from '@/lib/agente'
import { gestisceLaRete } from '@/lib/ruoli'
import { analizzaFatturaBrt } from '@/lib/controllo-fattura'
import type { RigaFatturaBrt } from '@/lib/fattura-brt'

// Mille e più righe, ognuna col listino rifatto dalla funzione dell'addebito: serve più del minuto standard.
export const maxDuration = 300

// CONTROLLO FATTURA CORRIERE. La fattura la legge il browser (lib/fattura-brt, la stessa lettura qui e là);
// qui arrivano le righe e si confrontano col costo registrato al detentore. Sola lettura: l'addebito ai
// clienti lo fa la Rettifica, la pagina le manda le differenze di peso come un file "solo pesi".
//
// Solo il DETENTORE: la fattura del corriere la riceve chi ha il contratto col corriere, e il confronto
// mostra il suo costo e le spedizioni di chi gli compra il contratto. Un sotto-master non deve vederlo.
async function contrattiDelDetentore(admin: any, masterId: string) {
  const { data } = await admin.from('corrieri').select('id,nome_contratto,tipo,contratto_id,proprio,attivo')
    .eq('master_id', masterId).eq('tipo', 'brt').eq('proprio', true)
  // Il detentore è la riga che porta il codice di sé stessa: le copie hanno il codice del contratto di sopra.
  return (data || []).filter((c: any) => c.contratto_id === c.id)
}

async function utenteDetentore() {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { errore: NextResponse.json({ error: 'Non autenticato' }, { status: 401 }) }
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo').eq('id', user.id).single()
  const blocco = bloccaAgente(utente as any); if (blocco) return { errore: blocco }
  // master_id da solo non è un permesso (ce l'hanno anche clienti e autisti): conta il ruolo.
  if (!utente?.master_id || !gestisceLaRete(utente)) return { errore: NextResponse.json({ error: 'Non autorizzato' }, { status: 403 }) }
  return { masterId: utente.master_id as string }
}

export async function GET() {
  const u = await utenteDetentore(); if (u.errore) return u.errore
  const contratti = await contrattiDelDetentore(createAdminSupabase(), u.masterId)
  return NextResponse.json({ contratti: contratti.map((c: any) => ({ id: c.id, nome: c.nome_contratto, attivo: c.attivo })) })
}

export async function POST(req: NextRequest) {
  const u = await utenteDetentore(); if (u.errore) return u.errore
  const admin = createAdminSupabase()
  const { contrattoId, righe } = await req.json() as { contrattoId?: string; righe?: RigaFatturaBrt[] }
  const contratti = await contrattiDelDetentore(admin, u.masterId)
  if (!contrattoId || !contratti.some((c: any) => c.id === contrattoId)) {
    return NextResponse.json({ error: 'Contratto non tuo: la fattura del corriere la controlla solo chi detiene il contratto.' }, { status: 403 })
  }
  if (!Array.isArray(righe) || !righe.length) return NextResponse.json({ error: 'Nessuna riga da controllare.' }, { status: 400 })
  if (righe.length > 20000) return NextResponse.json({ error: 'File troppo grande: dividilo per fattura.' }, { status: 400 })

  let esiti
  try {
    esiti = await analizzaFatturaBrt(admin, { contrattoId, masterId: u.masterId, righe })
  } catch (e: any) {
    // Una lettura saltata non deve diventare "spedizione non trovata": meglio fermarsi e dirlo.
    return NextResponse.json({ error: 'Controllo non riuscito: ' + String(e?.message || e) }, { status: 500 })
  }

  // Chi ha spedito: cliente diretto del detentore oppure sotto-master che gli compra il contratto.
  const clientiIds = Array.from(new Set(esiti.map(e => e.spedizione?.cliente_id).filter(Boolean))) as string[]
  const masterIds = Array.from(new Set(esiti.map(e => e.spedizione?.master_id).filter(m => m && m !== u.masterId))) as string[]
  const nomi: Record<string, string> = {}
  for (let i = 0; i < clientiIds.length; i += 200) {
    const { data } = await admin.from('clienti').select('id,ragione_sociale').in('id', clientiIds.slice(i, i + 200))
    for (const c of data || []) nomi[c.id] = c.ragione_sociale
  }
  for (let i = 0; i < masterIds.length; i += 200) {
    const { data } = await admin.from('masters').select('id,nome').in('id', masterIds.slice(i, i + 200))
    for (const m of data || []) nomi[m.id] = m.nome
  }

  return NextResponse.json({
    esiti: esiti.map(e => ({
      riga: e.riga,
      spedizione: e.spedizione && {
        id: e.spedizione.id, numero: e.spedizione.numero, stato: e.spedizione.stato,
        data: e.spedizione.created_at, colli: e.spedizione.colli,
        peso: Number(e.spedizione.peso_fatturato || e.spedizione.peso_reale || 0),
        contrassegno: Number(e.spedizione.contrassegno || 0), citta: e.spedizione.dest_citta || '',
        // Il sotto-master per nome, il cliente diretto per ragione sociale: chi riceverà la rettifica.
        chi: e.spedizione.master_id !== u.masterId ? (nomi[e.spedizione.master_id] || 'Sotto-master') : (nomi[e.spedizione.cliente_id || ''] || 'Cliente'),
      },
      abbinataPer: e.abbinataPer,
      brt: e.brt, moove: e.moove, listino: e.listino?.totale ?? null, zona: e.listino?.zona ?? null,
      differenza: e.differenza, motivi: e.motivi, voci: e.vociPerCategoria,
    })),
  })
}
