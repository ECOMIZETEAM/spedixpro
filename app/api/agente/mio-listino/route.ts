import { NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'

// Listino assegnato all'AGENTE (il suo costo), in SOLA LETTURA.
// Ritorna nome + fasce/prezzi raggruppati per corriere e zona.
export async function GET() {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: u } = await supabase.from('utenti').select('ruolo,listino_agente_id,master_id').eq('id', user.id).single()
  const ruolo = (u?.ruolo || '').toLowerCase()
  // "Il mio listino" = il COSTO assegnato dal referente. Vale per l'AGENTE (listino_agente_id) e per il
  // SOTTO-MASTER (masters.parent_listino_id). Prima era solo-agente (403): i sotto-master come
  // Velox/Spedizioni2000 (che accedono come master/admin) vedevano "Nessun listino assegnato" pur
  // avendo il listino assegnato e materializzato. La RLS tiene il listino del referente sotto il PADRE,
  // quindi per i sotto-master si legge via ADMIN, scoped al PROPRIO parent_listino_id (nessun id dal client).
  let listinoId: string | null = null
  let db: any = supabase
  if (ruolo === 'agente') {
    listinoId = (u as any)?.listino_agente_id || null
  } else if (['master', 'admin', 'operatore'].includes(ruolo)) {
    const { createAdminSupabase } = await import('@/lib/supabase-admin')
    db = createAdminSupabase()
    const { data: mm } = await db.from('masters').select('parent_listino_id').eq('id', (u as any)?.master_id).maybeSingle()
    listinoId = (mm as any)?.parent_listino_id || null
  } else {
    return NextResponse.json({ error: 'Non disponibile' }, { status: 403 })
  }
  if (!listinoId) return NextResponse.json({ assegnato: false, corrieri: [] })

  const { data: listino } = await db.from('listini_clienti').select('nome,fattore_volume,solo_peso_reale').eq('id', listinoId).maybeSingle()
  const { data: aggCorr } = await db.from('listini_clienti_corrieri').select('corriere_id,fattore_volume').eq('listino_id', listinoId)
  const fattorePerCorr = new Map<string, number>()
  for (const a of (aggCorr || [])) { const fv = parseFloat((a as any)?.fattore_volume); if ((a as any)?.corriere_id && fv > 0) fattorePerCorr.set((a as any).corriere_id, fv) }

  const { data: fasce } = await db.from('listini_clienti_fasce')
    .select('corriere_id,peso_max,prezzo,tipo,fuel,zone(nome),corrieri(nome_contratto,attivo,master_id)')
    .eq('listino_id', listinoId).order('peso_max', { ascending: true })

  // MOSTRA i contratti in pausa col FLAG (come il master, non come il cliente): l'agente vede il
  // listino anche a contratto in pausa; il CLIENTE finale invece non li vede (lo filtra
  // /api/cliente/listino-prezzi). pausa propria (attivo=false) o da un livello superiore (catena).
  const { contrattiSospesiSopra, sospesoDallaCatena } = await import('@/lib/contratti-catena')
  const masterDelContratto = (fasce || []).map((f: any) => (f as any).corrieri?.master_id).find(Boolean) || null
  const sospesiSopra = await contrattiSospesiSopra(masterDelContratto)

  const defFattore = parseFloat((listino as any)?.fattore_volume) || 5000
  // Griglia come il listino corrieri del master: righe = fasce peso, colonne = zone.
  const perCorr = new Map<string, any>()
  for (const f of (fasce || [])) {
    const cid = (f as any).corriere_id
    if (!cid) continue
    const cRec = (f as any).corrieri
    const pausaCatena = sospesoDallaCatena(cRec?.nome_contratto, sospesiSopra)
    const pausaPropria = cRec?.attivo === false
    if (!perCorr.has(cid)) {
      perCorr.set(cid, {
        nome_contratto: (f as any).corrieri?.nome_contratto || 'Corriere',
        fattore: fattorePerCorr.get(cid) || defFattore,
        zoneSet: new Set<string>(),
        fasce: new Map<string, any>(),
        pausa: pausaCatena || pausaPropria,
        pausaMotivo: pausaCatena ? 'catena' : (pausaPropria ? 'propria' : null),
      })
    }
    const e = perCorr.get(cid)
    const zonaNome = (f as any).zone?.nome || '—'
    e.zoneSet.add(zonaNome)
    const key = (f as any).tipo + '|' + (f as any).peso_max
    if (!e.fasce.has(key)) e.fasce.set(key, { peso_max: Number((f as any).peso_max), tipo: (f as any).tipo, fuel: Number((f as any).fuel) || 0, prezzi: {} as Record<string, number> })
    e.fasce.get(key).prezzi[zonaNome] = Number((f as any).prezzo)
  }
  // SUPPLEMENTI (assicurazione, contrassegno, servizi accessori, giacenze, ritiro…) per corriere.
  const parse = (s: any) => { try { return JSON.parse(s) } catch { return null } }
  const { data: suppl } = await db.from('listini_clienti_supplementi')
    .select('corriere_id,tipo,nome,descrizione,valore,tipo_calcolo').eq('listino_id', listinoId)
  const supplPerCorr = new Map<string, any[]>()
  for (const s of (suppl || [])) {
    const cid = (s as any).corriere_id; if (!cid) continue
    const d = parse((s as any).descrizione)
    const row = {
      tipo: (s as any).tipo,
      nome: (s as any).nome ?? d?.nome ?? null,
      valore_max: d?.valore_max != null ? Number(d.valore_max) : null,
      prezzo: Number(d?.prezzo_fisso ?? d?.prezzo ?? (s as any).valore ?? 0),
      perc: Number(d?.perc ?? 0),
      calcolo_su: d?.calcolo_su || (s as any).tipo_calcolo || null,
      // Come nella vista del cliente: la soglia della sponda e la banda di peso degli scaglioni.
      // Senza, la sponda non si poteva mostrare e due scaglioni con bande diverse erano
      // indistinguibili. `peso_min`/`peso_max` arrivano spesso come stringa vuota, non come null.
      soglia_kg: d?.soglia_kg != null ? Number(d.soglia_kg) : null,
      peso_min: d?.peso_min !== '' && d?.peso_min != null ? Number(d.peso_min) : null,
      peso_max: d?.peso_max !== '' && d?.peso_max != null ? Number(d.peso_max) : null,
    }
    if (!supplPerCorr.has(cid)) supplPerCorr.set(cid, [])
    supplPerCorr.get(cid)!.push(row)
  }
  const ordScaglioni = (a: any, b: any) => {
    const va = a.valore_max, vb = b.valore_max
    if (va == null && vb == null) return 0
    if (va == null) return 1
    if (vb == null) return -1
    return va - vb
  }

  const ordZona = (a: string, b: string) => (a === 'Italia' ? -1 : b === 'Italia' ? 1 : a.localeCompare(b))
  const corrieri = Array.from(perCorr.entries())
    .sort((a, b) => ((a[1].pausa ? 1 : 0) - (b[1].pausa ? 1 : 0)) || a[1].nome_contratto.localeCompare(b[1].nome_contratto))
    .map(([cid, c]) => {
      const sup = supplPerCorr.get(cid) || []
      const perTipo = (t: string) => sup.filter((r: any) => r.tipo === t)
      return {
        nome_contratto: c.nome_contratto,
        pausa: !!c.pausa,
        pausaMotivo: c.pausaMotivo || null,
        fattore: c.fattore,
        zone: Array.from(c.zoneSet).sort(ordZona as any),
        fasce: Array.from(c.fasce.values()).sort((a: any, b: any) => (a.tipo === 'oltre' ? 1 : 0) - (b.tipo === 'oltre' ? 1 : 0) || a.peso_max - b.peso_max),
        supplementi: {
          assicurazione: perTipo('assicurazione').sort(ordScaglioni),
          contrassegno: perTipo('contrassegno').sort(ordScaglioni),
          accessorio: perTipo('accessorio'),
          giacenza: [...perTipo('giacenza'), ...perTipo('giacenza_apertura')],
          ritiro: perTipo('ritiro'),
          sponda: perTipo('sponda'),
        },
      }
    })
  return NextResponse.json({
    assegnato: true,
    nome: (listino as any)?.nome || 'Listino',
    solo_peso_reale: !!(listino as any)?.solo_peso_reale,
    corrieri,
  })
}
