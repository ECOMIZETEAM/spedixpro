import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { bloccaCronNonAutorizzato } from '@/lib/cron-auth'
import { vedeLaRete } from '@/lib/perimetro'
import { registraMovimento } from '@/lib/movimenti'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

// LA GIACENZA A MAGAZZINO, ADDEBITATA UNA VOLTA AL MESE.
//
// Si paga il POSTO occupato, non il peso: un bancale mezzo vuoto costa come uno pieno, come nei
// magazzini veri. Il prezzo e' quello del tipo di posto, deciso dal master.
//
// SI PUO' GUARDARE PRIMA DI FARLO. Con ?anteprima=1 la rotta dice esattamente chi pagherebbe
// quanto, senza toccare un centesimo. E' il modo in cui va acceso la prima volta: si guarda, si
// controlla che i numeri siano quelli attesi, e solo dopo si lascia partire il giro vero.
// Un addebito automatico che parte a sorpresa su clienti veri e' il guasto peggiore di tutti.
//
// NON PUO' ADDEBITARE DUE VOLTE LO STESSO MESE: l'indice unico (blocco, mese) lo impedisce, quindi
// rilanciarlo a mano — o due volte per sbaglio — non fa danni.
//
// Chi ha liberato il posto non paga: si guardano solo i posti ancora occupati, cioe' quelli con
// `liberato_il` nullo. Le righe liberate restano nello storico ma non entrano nel conto.

// La relazione incorporata puo' arrivare come oggetto o come elenco di uno a seconda di come
// PostgREST tipizza la join: si normalizza qui, una volta, invece di indovinare a ogni uso.
const tipoDi = (p: any) => (Array.isArray(p?.logistica_tipi_blocco) ? p.logistica_tipi_blocco[0] : p?.logistica_tipi_blocco) || {}
const clienteDi = (p: any) => (Array.isArray(p?.clienti) ? p.clienti[0] : p?.clienti) || {}

function meseDi(d = new Date()) {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

// IL PERIODO DA FATTURARE, nei due modi che il master puo' scegliere.
//
// 'solare'   -> il mese di calendario: la chiave e' "2026-08". Un posto occupato il 30 agosto paga
//               agosto e poi settembre — si paga il mese iniziato, come in molti magazzini.
// 'giorni30' -> trenta giorni veri dall'occupazione: la chiave e' la data d'inizio del periodo in
//               corso, es. "2026-08-04". Piu' giusto verso il cliente, date meno leggibili.
//
// In tutti e due i casi la chiave finisce nella stessa colonna e nello stesso indice unico
// (blocco, periodo): e' quello che impedisce di fatturare due volte lo stesso periodo, qualunque
// modo si sia scelto e quante volte si rilanci il giro.
function periodoDi(modo: string, occupatoDal: string, oggi = new Date()): string {
  if (modo !== 'giorni30') return meseDi(oggi)
  const inizio = new Date(occupatoDal + 'T00:00:00Z')
  const giorni = Math.floor((oggi.getTime() - inizio.getTime()) / 86400000)
  if (giorni < 0) return meseDi(oggi)
  const n = Math.floor(giorni / 30)
  const dal = new Date(inizio.getTime() + n * 30 * 86400000)
  return dal.toISOString().slice(0, 10)
}

export async function GET(req: NextRequest) {
  const anteprima = req.nextUrl.searchParams.get('anteprima') === '1'

  // Il giro vero lo fa solo il cron. L'anteprima puo' guardarla anche il master dal portale —
  // e' una lettura, non muove niente.
  const supabase = await createServerSupabase()
  let master: string | null = null
  if (anteprima) {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
    const { data: u } = await supabase.from('utenti').select('ruolo,master_id').eq('id', user.id).single()
    if (!vedeLaRete(u)) return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
    master = u.master_id
  } else {
    const _b = bloccaCronNonAutorizzato(req); if (_b) return _b
  }

  const admin = createAdminSupabase()
  const meseForzato = req.nextUrl.searchParams.get('mese')

  let q = admin.from('logistica_blocchi')
    .select('id,master_id,cliente_id,ubicazione,occupato_dal,logistica_tipi_blocco(nome,prezzo_mese),clienti(ragione_sociale)')
    .is('liberato_il', null)
  if (master) {
    const { sottoAlberoMasterIds } = await import('@/lib/rete-masters')
    const rete = await sottoAlberoMasterIds(admin, master)
    q = q.in('master_id', rete.length ? rete : ['00000000-0000-0000-0000-000000000000'])
  }
  const { data: posti, error } = await q.limit(2000)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Il modo di contare il periodo e' del MASTER a cui appartiene il posto: in una rete ognuno puo'
  // avere il suo magazzino e le sue abitudini.
  const masterIds = Array.from(new Set((posti || []).map((p: any) => p.master_id)))
  const { data: mm } = await admin.from('masters').select('id,logistica_periodo')
    .in('id', masterIds.length ? masterIds : ['00000000-0000-0000-0000-000000000000'])
  const modoDi = new Map((mm || []).map((m: any) => [m.id, m.logistica_periodo || 'solare']))
  const periodoDelPosto = (p: any) => periodoDi(modoDi.get(p.master_id) || 'solare', p.occupato_dal)

  // Cosa e' gia' stato fatturato per questo mese: serve sia all'anteprima (per non contarlo due
  // volte) sia al giro vero.
  // Cosa e' gia' stato fatturato, per QUALSIASI periodo: il confronto e' per (posto, periodo), e i
  // periodi ora possono essere mesi o finestre di trenta giorni.
  const { data: fatti } = await admin.from('logistica_addebiti')
    .select('blocco_id,mese').eq('tipo', 'giacenza')
    .in('blocco_id', (posti || []).map((p: any) => p.id).slice(0, 2000))
  const gia = new Set((fatti || []).map((f: any) => `${f.blocco_id}|${f.mese}`))

  const daFare = (posti || []).filter((p: any) =>
    Number(tipoDi(p).prezzo_mese || 0) > 0 &&
    !gia.has(`${p.id}|${meseForzato || periodoDelPosto(p)}`))
  const totale = Math.round(daFare.reduce((s: number, p: any) => s + Number(tipoDi(p).prezzo_mese), 0) * 100) / 100

  if (anteprima) {
    const perCliente = new Map<string, { cliente: string; posti: number; importo: number }>()
    for (const p of daFare) {
      const k = p.cliente_id
      const r = perCliente.get(k) || { cliente: clienteDi(p).ragione_sociale || '—', posti: 0, importo: 0 }
      r.posti++; r.importo = Math.round((r.importo + Number(tipoDi(p).prezzo_mese)) * 100) / 100
      perCliente.set(k, r)
    }
    return NextResponse.json({
      anteprima: true, mese: meseForzato || meseDi(),
      posti_da_fatturare: daFare.length,
      gia_fatturati: gia.size,
      totale,
      clienti: Array.from(perCliente.values()).sort((a, b) => b.importo - a.importo),
    })
  }

  let addebitati = 0, saltati = 0
  let euro = 0
  for (const p of daFare) {
    const prezzo = Number(tipoDi(p).prezzo_mese)
    const periodo = meseForzato || periodoDelPosto(p)
    const descrizione = `Giacenza magazzino ${periodo} — ${tipoDi(p).nome}${p.ubicazione ? ' · ' + p.ubicazione : ''}`
    try {
      // PRIMA il segno che e' stato fatto, POI il movimento: se l'indice unico rifiuta (mese gia'
      // fatturato) non si arriva nemmeno a toccare il credito. L'ordine inverso lascerebbe la
      // porta aperta a un addebito senza traccia.
      const { error: eAdd } = await admin.from('logistica_addebiti').insert({
        master_id: p.master_id, cliente_id: p.cliente_id, tipo: 'giacenza', mese: periodo,
        blocco_id: p.id, importo: prezzo, descrizione,
      })
      if (eAdd) { if ((eAdd as any).code === '23505') { saltati++; continue } throw eAdd }

      // Il credito si muove SOLO da qui (lib/movimenti -> RPC): mai con una update diretta.
      // Niente richiediCapienza: la giacenza deve poter andare sotto zero, come i resi e le
      // giacenze dei corrieri — la merce e' gia' in magazzino, il servizio e' gia' stato dato.
      await registraMovimento(admin, {
        masterId: p.master_id, clienteId: p.cliente_id, tipo: 'logistica' as any,
        descrizione, importo: -Math.abs(prezzo), riferimento: `LOG-${periodo}`,
      })
      addebitati++; euro = Math.round((euro + prezzo) * 100) / 100
    } catch (e: any) {
      console.error('[LOGISTICA-MENSILE] addebito fallito', p.id, e?.message)
    }
  }

  const esito = { addebitati, saltati_gia_fatti: saltati, euro }
  console.log('[LOGISTICA-MENSILE]', JSON.stringify(esito))
  return NextResponse.json(esito)
}
