import { NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { fetchAll } from '@/lib/fetch-all'
import { marchioCorriere } from '@/lib/corriere-logo'
export async function GET() {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('cliente_id').eq('id', user.id).single()
  const clienteId = utente?.cliente_id
  if (!clienteId) return NextResponse.json({ error: 'Cliente non trovato' }, { status: 400 })
  const distinte = await fetchAll(() => supabase
    .from('distinte')
    .select('id,numero,data,stato,totale_colli,totale_peso,corriere_id,created_at,corrieri(nome_contratto)')
    .eq('cliente_id', clienteId)
    .order('created_at', { ascending: false }))

  // Il contratto puo' appartenere a un master PIU' IN ALTO della catena: in quel caso l'RLS sui
  // corrieri (master_id IN mia_rete_master()) impedisce al cliente di leggerlo e le colonne
  // Vettore e Contratto restavano VUOTE sulla sua distinta.
  // Lo leggiamo quindi per via amministrativa, ma SOLO per i contratti che compaiono sulle SUE
  // distinte (la query sopra e' gia' filtrata su cliente_id) e prendendo solo il nome: mai le
  // credenziali, mai il tipo (che e' il provider e non deve uscire).
  const nomiContratto = new Map<string, string>()
  const idsMancanti = Array.from(new Set(
    (distinte || []).filter((d: any) => d.corriere_id && !d.corrieri?.nome_contratto).map((d: any) => d.corriere_id)
  ))
  if (idsMancanti.length) {
    const { createAdminSupabase } = await import('@/lib/supabase-admin')
    const { data: corr } = await createAdminSupabase()
      .from('corrieri').select('id,nome_contratto').in('id', idsMancanti)
    for (const c of corr || []) nomiContratto.set((c as any).id, (c as any).nome_contratto || '')
  }

  // Nome del contratto: quello letto normalmente, oppure il ripiego amministrativo qui sopra.
  const nomeContrattoDi = (d: any): string =>
    d.corrieri?.nome_contratto || nomiContratto.get(d.corriere_id) || ''

  // Aggregati (colli/contrassegni/peso/costo/numero spedizioni) per distinta in UNA sola query .in()
  // invece di N query (una per distinta): era un N+1 che teneva la pagina in "Caricamento…" finché
  // non finivano tutte. Raggruppo per distinta_id in memoria; output identico a prima.
  const idsDistinte = (distinte || []).map((d: any) => d.id)
  type Agg = { n: number; colli: number; contrassegni: number; peso: number; costo: number }
  const nuovoAgg = (): Agg => ({ n: 0, colli: 0, contrassegni: 0, peso: 0, costo: 0 })
  const perDistinta = new Map<string, Agg>()
  if (idsDistinte.length) {
    const speds = await fetchAll(() => supabase
      .from('spedizioni')
      .select('distinta_id,costo_totale,contrassegno,colli,peso_fatturato,peso_reale')
      .in('distinta_id', idsDistinte))
    for (const s of speds || []) {
      const k = (s as any).distinta_id
      if (!k) continue
      const a = perDistinta.get(k) || nuovoAgg()
      a.n += 1
      a.colli += Number((s as any).colli) || 0
      a.contrassegni += Number((s as any).contrassegno) || 0
      a.peso += Number((s as any).peso_fatturato || (s as any).peso_reale) || 0
      a.costo += Number((s as any).costo_totale) || 0
      perDistinta.set(k, a)
    }
  }

  const result = []
  for (const d of distinte || []) {
    const a = perDistinta.get(d.id) || nuovoAgg()
    result.push({
      id: d.id, numero: d.numero, data: d.data || d.created_at, created_at: d.created_at, stato: d.stato,
      // MAI corrieri.tipo: contiene il provider tecnico ('spediamopro', 'spedisci') e finiva
      // stampato al cliente nella colonna "Vettore". Il vettore e' il marchio del contratto.
      vettore: marchioCorriere(nomeContrattoDi(d)), contratto: nomeContrattoDi(d),
      spedizioni: a.n, colli: a.colli || d.totale_colli || 0, contrassegni: a.contrassegni, peso: a.peso || Number(d.totale_peso) || 0, costo: a.costo,
    })
  }
  return NextResponse.json(result)
}