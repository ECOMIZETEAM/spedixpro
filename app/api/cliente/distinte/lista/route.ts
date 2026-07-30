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

  const result = []
  for (const d of distinte || []) {
    const { data: speds } = await supabase
      .from('spedizioni')
      .select('costo_totale,contrassegno,colli,peso_fatturato,peso_reale')
      .eq('distinta_id', d.id)
    const nSped = (speds || []).length
    const colli = (speds || []).reduce((a, s) => a + (Number(s.colli) || 0), 0)
    const contrassegni = (speds || []).reduce((a, s) => a + (Number(s.contrassegno) || 0), 0)
    const peso = (speds || []).reduce((a, s) => a + (Number(s.peso_fatturato || s.peso_reale) || 0), 0)
    const costo = (speds || []).reduce((a, s) => a + (Number(s.costo_totale) || 0), 0)
    result.push({
      id: d.id, numero: d.numero, data: d.data || d.created_at, stato: d.stato,
      // MAI corrieri.tipo: contiene il provider tecnico ('spediamopro', 'spedisci') e finiva
      // stampato al cliente nella colonna "Vettore". Il vettore e' il marchio del contratto.
      vettore: marchioCorriere(nomeContrattoDi(d)), contratto: nomeContrattoDi(d),
      spedizioni: nSped, colli: colli || d.totale_colli || 0, contrassegni, peso: peso || Number(d.totale_peso) || 0, costo,
    })
  }
  return NextResponse.json(result)
}