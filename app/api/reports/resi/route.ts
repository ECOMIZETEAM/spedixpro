import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { isAgente, clientiAgente } from '@/lib/agente'
import { vedeLaRete } from '@/lib/perimetro'
import { fetchAllStretto } from '@/lib/fetch-all'
import { confineGiornoRoma } from '@/lib/date-roma'
import { contrattiPossedutiNomi } from '@/lib/rete-masters'
import { ledgerFornitoriDaNascondere } from '@/lib/gambe-visibilita'

export const maxDuration = 300

// REPORT RESI: i resi ADDEBITATI nel periodo, con quello che ha pagato il DIRETTO.
//
// Prima il report prendeva le spedizioni con stato `reso_mittente` CREATE nel periodo e sommava il
// nolo: su MULTIEXPRESS dall'1 al 14/10 uscivano 184 righe contro 532 resi addebitati in quei giorni
// (364 su spedizioni di settembre o prima, che per data di creazione non c'entravano; misurato il
// 15/10), e il totale era il prezzo della spedizione, non quello del reso.
// Ora:
//  - il periodo e' la data dell'ADDEBITO: il primo movimento 'reso' della spedizione fra quelli dei
//    master che guardo (giorni di Roma);
//  - l'importo e' il reso addebitato al DIRETTO: il cliente (movimento col SUO cliente_id) oppure, per
//    la rete, il sotto-master di prima linea (master_target_id, cliente_id vuoto). Mai il prezzo del
//    cliente finale di un sotto-master;
//  - il perimetro e' quello dell'elenco spedizioni: sotto-albero, contratti posseduti, niente gambe dei
//    fornitori, niente annullate; l'agente solo i suoi clienti e solo l'addebito al cliente.
const COLONNE = 'id,numero,master_id,cliente_id,stato,created_at,tracking_number,dest_nome,dest_citta,dest_provincia,clienti(ragione_sociale),corrieri(nome_contratto)'

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo,nome,cognome').eq('id', user.id).single()
  const agente = isAgente(utente)
  // Cliente e autista: niente. Il cliente i suoi resi li vede dal suo portale.
  if (!utente?.master_id || (!agente && !vedeLaRete(utente))) return NextResponse.json({ error: 'Non consentito' }, { status: 403 })
  const mio = utente.master_id
  const p = req.nextUrl.searchParams
  const dal = confineGiornoRoma(p.get('dal'), 'dal')
  const al = confineGiornoRoma(p.get('al'), 'al')
  if (!dal || !al) return NextResponse.json({ error: 'Indica il periodo (dal/al)' }, { status: 400 })
  const clienteIdRaw = p.get('clienteId')
  const masterSel = clienteIdRaw && clienteIdRaw.startsWith('m:') ? clienteIdRaw.slice(2) : null
  const clienteId = masterSel ? null : clienteIdRaw
  const admin = createAdminSupabase()

  try {
    // ── Rete: io + discendenza, con la prima linea di ognuno (il figlio diretto da cui scende).
    const { data: ms, error: eM } = await admin.from('masters').select('id,nome,parent_master_id')
    if (eM) throw new Error(eM.message)
    const nomeMaster = new Map<string, string>()
    const figliDi = new Map<string, string[]>()
    for (const m of (ms || []) as any[]) {
      nomeMaster.set(m.id, m.nome)
      if (!m.parent_master_id) continue
      if (!figliDi.has(m.parent_master_id)) figliDi.set(m.parent_master_id, [])
      figliDi.get(m.parent_master_id)!.push(m.id)
    }
    const sottoAlbero = (radice: string) => {
      const ids = [radice]; const visti = new Set(ids); let fr = [radice]
      for (let i = 0; i < 20 && fr.length; i++) {
        const nu: string[] = []
        for (const f of fr) for (const c of (figliDi.get(f) || [])) if (!visti.has(c)) { visti.add(c); ids.push(c); nu.push(c) }
        fr = nu
      }
      return ids
    }
    const primaLinea = new Map<string, string>()
    {
      let fr = [mio]
      for (let i = 0; i < 20 && fr.length; i++) {
        const nu: string[] = []
        for (const f of fr) for (const c of (figliDi.get(f) || [])) if (!primaLinea.has(c)) { primaLinea.set(c, f === mio ? c : (primaLinea.get(f) || c)); nu.push(c) }
        fr = nu
      }
    }
    // I master di cui guardo i movimenti (per la data dell'addebito) e quelli di cui mostro le righe.
    const mieiMaster = agente ? [mio] : sottoAlbero(mio)
    let righeMaster = mieiMaster
    if (masterSel) righeMaster = (!agente && mieiMaster.includes(masterSel)) ? sottoAlbero(masterSel) : []
    if (!righeMaster.length) return NextResponse.json([])
    const reteVisibile = righeMaster.some(id => id !== mio)
    // Nessun contratto posseduto = nessun filtro, come nell'Elenco spedizioni e nelle Giacenze. Con un
    // insieme vuoto il report della piattaforma (master senza contratti) usciva sempre vuoto.
    const nomiPosseduti = reteVisibile ? await contrattiPossedutiNomi(admin, mio) : []
    const posseduti = nomiPosseduti.length ? new Set(nomiPosseduti) : null
    const nascosti = new Set(agente ? [] : await ledgerFornitoriDaNascondere(admin, mio))
    const idsAgente = agente ? new Set(await clientiAgente(supabase, utente)) : null
    const righeMasterSet = new Set(righeMaster), mieiMasterSet = new Set(mieiMaster)

    // 1. Le spedizioni con un reso addebitato nel periodo da uno dei miei master.
    const movPeriodo = await fetchAllStretto(() => admin.from('movimenti').select('spedizione_id')
      .eq('tipo', 'reso').not('spedizione_id', 'is', null).in('master_id', mieiMaster)
      .gte('created_at', dal).lte('created_at', al)
      .order('created_at', { ascending: true }).order('id', { ascending: true }))
    const idsPeriodo = [...new Set(movPeriodo.map((m: any) => m.spedizione_id))] as string[]
    if (!idsPeriodo.length) return NextResponse.json([])

    // 2. Le loro gambe. Su un pacco condiviso il reso e' del PACCO e si registra sulla gamba ORIGINANTE
    // (REGOLE.md): chi guarda dal lato del venditore vede un'altra gamba con lo stesso tracking.
    const perId = new Map<string, any>()
    for (let i = 0; i < idsPeriodo.length; i += 200) {
      const { data, error } = await admin.from('spedizioni').select(COLONNE).in('id', idsPeriodo.slice(i, i + 200))
      if (error) throw new Error(error.message)
      for (const s of (data || []) as any[]) perId.set(s.id, s)
    }
    const tracking = [...new Set([...perId.values()].map((s: any) => s.tracking_number).filter(Boolean))] as string[]
    for (let i = 0; i < tracking.length; i += 150) {
      const gg = await fetchAllStretto(() => admin.from('spedizioni').select(COLONNE)
        .in('tracking_number', tracking.slice(i, i + 150)).order('id', { ascending: true }))
      for (const s of gg) perId.set(s.id, s)
    }
    const gambeDi = new Map<string, string[]>()
    for (const s of perId.values()) if (s.tracking_number) {
      if (!gambeDi.has(s.tracking_number)) gambeDi.set(s.tracking_number, [])
      gambeDi.get(s.tracking_number)!.push(s.id)
    }
    const gambe = (s: any): string[] => s.tracking_number ? (gambeDi.get(s.tracking_number) || [s.id]) : [s.id]

    // 3. Le righe che vedo, con le stesse regole dell'elenco spedizioni.
    const visibili = [...perId.values()].filter((s: any) => {
      if (!righeMasterSet.has(s.master_id)) return false
      if (s.stato === 'annullata') return false
      if (s.cliente_id && nascosti.has(s.cliente_id)) return false
      if (posseduti && !posseduti.has(String(s.corrieri?.nome_contratto ?? ''))) return false
      if (idsAgente && !idsAgente.has(s.cliente_id)) return false
      if (clienteId && (s.cliente_id !== clienteId || s.master_id !== mio)) return false
      return true
    })

    // 4. Tutti i movimenti 'reso' di quelle gambe, di qualunque data: serve il PRIMO addebito.
    const idsGambe = [...new Set(visibili.flatMap(gambe))]
    const movPerSped = new Map<string, any[]>()
    for (let i = 0; i < idsGambe.length; i += 200) {
      const blocco = idsGambe.slice(i, i + 200)
      const mov = await fetchAllStretto(() => admin.from('movimenti')
        .select('id,spedizione_id,master_id,cliente_id,master_target_id,importo,created_at')
        .eq('tipo', 'reso').in('spedizione_id', blocco).order('spedizione_id', { ascending: true }).order('id', { ascending: true }))
      for (const m of mov) {
        if (!movPerSped.has(m.spedizione_id)) movPerSped.set(m.spedizione_id, [])
        movPerSped.get(m.spedizione_id)!.push(m)
      }
    }

    const tDal = Date.parse(dal), tAl = Date.parse(al)
    const out: any[] = []
    for (const s of visibili) {
      const movs = gambe(s).flatMap(id => movPerSped.get(id) || [])
      const miei = movs.filter((m: any) => mieiMasterSet.has(m.master_id))
      if (!miei.length) continue
      const primo = miei.reduce((a: string, m: any) => (Date.parse(m.created_at) < Date.parse(a) ? m.created_at : a), miei[0].created_at)
      const tPrimo = Date.parse(primo)
      if (tPrimo < tDal || tPrimo > tAl) continue
      const fl = s.master_id === mio ? null : (primaLinea.get(s.master_id) || null)
      let importo: number | null = null
      if ((s.master_id === mio && s.cliente_id) || fl) {
        let somma = 0
        for (const m of movs) {
          // Verso il sotto-master di prima linea: solo addebiti scritti da me o da lui sul conto rete, mai
          // quelli di un terzo ne' il conto 'proprio', e i suoi su se stesso solo se sto nella catena.
          const alDiretto = s.master_id === mio
            ? (!!m.cliente_id && m.cliente_id === s.cliente_id)
            : (!m.cliente_id && m.master_target_id === fl && m.conto !== 'proprio'
              && (m.master_id === mio || (m.master_id === fl && inCatena.has(m.spedizione_id))))
          if (alDiretto) somma += Number(m.importo || 0)
        }
        // Importi con segno: l'addebito e' negativo, lo storno positivo.
        importo = Math.round(-somma * 100) / 100
      }
      out.push({
        id: s.id, numero: s.numero, stato: s.stato, created_at: s.created_at,
        cliente: s.clienti?.ragione_sociale || null,
        master_rete: fl ? (nomeMaster.get(fl) || null) : null,
        dest_nome: s.dest_nome, dest_citta: s.dest_citta, dest_provincia: s.dest_provincia,
        contratto: s.corrieri?.nome_contratto || null,
        data_addebito: primo, importo_reso: importo,
      })
    }
    out.sort((a, b) => Date.parse(b.data_addebito) - Date.parse(a.data_addebito) || String(b.numero).localeCompare(String(a.numero)))
    return NextResponse.json(out)
  } catch (e: any) {
    return NextResponse.json({ error: 'Report resi non riuscito: ' + (e?.message || e) }, { status: 500 })
  }
}
