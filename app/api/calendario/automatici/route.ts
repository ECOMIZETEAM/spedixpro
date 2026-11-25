import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { getPermessiUtente, haPermesso } from '@/lib/permessi'
import { isAgente, clientiAgente, idClientiPerFiltro } from '@/lib/agente'
import { vedeLaRete } from '@/lib/perimetro'
import { ledgerGambeInterne } from '@/lib/gambe-visibilita'
import { contrattiPossedutiNomi } from '@/lib/rete-masters'
import { fetchAllStretto } from '@/lib/fetch-all'
import { giornoRoma, inizioGiornoRomaISO, fineGiornoRomaISO } from '@/lib/date-roma'
import { vettoreFisico } from '@/lib/vettore'
import { numeroMostrato } from '@/lib/numero-spedizione'

// LE VOCI AUTOMATICHE DEL CALENDARIO: i ritiri prenotati (sul giorno del ritiro) e le giacenze ancora da gestire (sul
// giorno in cui il pacco è entrato in giacenza). Solo lettura, solo i campi da mostrare, nessun importo.
//
// CHI VEDE COSA. Il calendario non allarga mai quello che una persona vede oggi:
//  - le voci compaiono solo a chi vede la pagina corrispondente (Elenco Ritiri: admin.pickups.index; Giacenze:
//    admin.stocks.index), con la stessa regola del menu (lib/permessi);
//  - il cliente vede i suoi; l'agente quelli dei suoi clienti; lo staff del master quelli del PROPRIO master_id.
//    Le righe dei sotto-master restano fuori: nell'Elenco Ritiri di MULTIEXPRESS sono 28.703 in 30 giorni (~950 al
//    giorno), un calendario con quei numeri non si legge. Ognuno li trova nel calendario suo.
//  Il proprio master_id è un pezzo di ciò che l'Elenco Ritiri e la pagina Giacenze mostrano già (che partono dalla
//  rete intera e poi restringono ai contratti posseduti): qui si applicano le stesse due strette, contratti posseduti
//  e gambe interne nascoste (fn_ledger_nascosti), così una riga che lì è nascosta non compare nemmeno qui.
//
// PRIMA DEL RILASCIO: la regola «chi vede quali ritiri» vive oggi dentro /api/ritiri; va portata in una funzione sola
// usata da tutte e due le rotte, come chiede CLAUDE.md.

const GIORNO = /^\d{4}-\d{2}-\d{2}$/
const MAX_RIGHE = 5000

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo,cliente_id,nome,cognome').eq('id', user.id).single()
  if (!utente?.master_id) return NextResponse.json({ ritiri: [], giacenze: [] })
  const ruolo = String(utente.ruolo || '').toLowerCase()
  // l'autista lavora dalla sua app: niente ritiri e giacenze della rete
  if (ruolo === 'autista') return NextResponse.json({ ritiri: [], giacenze: [] })

  const p = req.nextUrl.searchParams
  const dal = p.get('dal') || '', al = p.get('al') || ''
  if (!GIORNO.test(dal) || !GIORNO.test(al) || dal > al) return NextResponse.json({ error: 'Periodo non valido' }, { status: 400 })
  // al massimo una griglia di mese abbondante (6 settimane) più margine
  if ((new Date(al).getTime() - new Date(dal).getTime()) / 86400000 > 62) return NextResponse.json({ error: 'Periodo troppo lungo' }, { status: 400 })

  const cliente = ruolo === 'cliente' && !!utente.cliente_id
  const agente = isAgente(utente)
  const staff = vedeLaRete(utente)
  if (!cliente && !agente && !staff) return NextResponse.json({ ritiri: [], giacenze: [] })

  // Il portale cliente non ha permessi a voci: vede i suoi ritiri e le sue giacenze, come nel suo menu.
  const perm = cliente ? null : await getPermessiUtente()
  const vedeRitiri = cliente || haPermesso(perm, 'admin.pickups.index')
  const vedeGiacenze = cliente || haPermesso(perm, 'admin.stocks.index')

  const admin = createAdminSupabase()
  const masterId = utente.master_id as string
  const idsAgente = agente ? idClientiPerFiltro(await clientiAgente(supabase, utente)) : null
  // lo staff: contratti posseduti e gambe interne, le stesse strette di Elenco Ritiri / Giacenze
  const [posseduti, nascosti] = staff
    ? await Promise.all([contrattiPossedutiNomi(admin, masterId), ledgerGambeInterne(admin, masterId)])
    : [[] as string[], [] as string[]]

  // ── RITIRI ──
  let ritiri: any[] = []
  let ritiriTroncati = false
  if (vedeRitiri) {
    try {
      const righe = await fetchAllStretto(() => {
        let q = admin.from('ritiri')
          .select(`id,data_ritiro,stato,cod_ritiro,tracking_ritiro,colli,peso,mitt_nome,mitt_citta,mitt_provincia,clienti(ragione_sociale),${posseduti.length ? 'corrieri!inner(nome_contratto,tipo)' : 'corrieri(nome_contratto,tipo)'}`)
          .eq('master_id', masterId)
          .gte('data_ritiro', dal).lte('data_ritiro', al)
          .order('data_ritiro', { ascending: true }).order('id', { ascending: true })
        if (cliente) q = q.eq('cliente_id', utente.cliente_id)
        if (idsAgente) q = q.in('cliente_id', idsAgente)
        if (posseduti.length) q = q.in('corrieri.nome_contratto', posseduti)
        return q
      }, MAX_RIGHE)
      ritiriTroncati = righe.length >= MAX_RIGHE
      ritiri = righe.map((r: any) => ({
        id: r.id, giorno: String(r.data_ritiro).slice(0, 10), stato: r.stato || 'richiesto',
        codice: r.cod_ritiro || r.tracking_ritiro || null,
        colli: r.colli ?? null, peso: r.peso != null ? Number(r.peso) : null,
        mittente: r.mitt_nome || null, citta: r.mitt_citta || null, provincia: r.mitt_provincia || null,
        cliente: cliente ? null : (r.clienti?.ragione_sociale || null),
        // il corriere vero (BRT, GLS, Poste…), mai il nome del contratto: dentro può esserci quello del fornitore
        contratto: r.corrieri ? vettoreFisico(r.corrieri) : null,
      }))
    } catch (e: any) {
      return NextResponse.json({ error: 'Lettura ritiri non riuscita: ' + (e?.message || e) }, { status: 500 })
    }
  }

  // ── GIACENZE ──
  // Solo quelle ancora da gestire (giacenza_stato aperta o non ancora scritto: il rilevamento valorizza solo la data).
  // Si guarda anche indietro di 45 giorni rispetto all'inizio del periodo: una giacenza aperta di tre settimane fa
  // resta «da fare» finché qualcuno non la gestisce, e la lista laterale la deve trovare.
  let giacenze: any[] = []
  if (vedeGiacenze) {
    const oggi = giornoRoma()
    const indietro = giornoRoma(new Date(Date.now() - 45 * 86400000))
    const da = [dal, indietro, oggi].sort()[0]
    try {
      const righe = await fetchAllStretto(() => {
        // l'indice parziale su giacenza_data (idx_sped_giacenza_data) regge la finestra di date; il resto filtra
        let q = admin.from('spedizioni')
          .select(`id,numero,tracking_number,giacenza_data,giacenza_motivo,dest_nome,dest_citta,dest_provincia,clienti(ragione_sociale),${posseduti.length ? 'corrieri!inner(nome_contratto,tipo)' : 'corrieri(nome_contratto,tipo)'}`)
          .not('giacenza_data', 'is', null)
          .gte('giacenza_data', inizioGiornoRomaISO(da)).lte('giacenza_data', fineGiornoRomaISO(al))
          .or('giacenza_stato.eq.aperta,giacenza_stato.is.null')
          .eq('master_id', masterId)
          .order('giacenza_data', { ascending: true }).order('id', { ascending: true })
        if (cliente) q = q.eq('cliente_id', utente.cliente_id)
        if (idsAgente) q = q.in('cliente_id', idsAgente)
        if (nascosti.length) q = q.or(`cliente_id.is.null,cliente_id.not.in.(${nascosti.join(',')})`)
        if (posseduti.length) q = q.in('corrieri.nome_contratto', posseduti)
        return q
      }, MAX_RIGHE)
      giacenze = righe.map((s: any) => ({
        id: s.id, giorno: giornoRoma(new Date(s.giacenza_data)),
        numero: numeroMostrato(s.numero, s.tracking_number) || null, tracking: s.tracking_number || null,
        destinatario: s.dest_nome || null, citta: s.dest_citta || null, provincia: s.dest_provincia || null,
        motivo: s.giacenza_motivo || null,
        cliente: cliente ? null : (s.clienti?.ragione_sociale || null),
        contratto: s.corrieri ? vettoreFisico(s.corrieri) : null,
      }))
    } catch (e: any) {
      return NextResponse.json({ error: 'Lettura giacenze non riuscita: ' + (e?.message || e) }, { status: 500 })
    }
  }

  return NextResponse.json({ ritiri, giacenze, ritiriTroncati, vedeRitiri, vedeGiacenze })
}
