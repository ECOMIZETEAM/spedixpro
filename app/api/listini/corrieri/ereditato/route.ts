import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'

// Listino "ereditato" per un SOTTO-MASTER: i prezzi che il master padre gli ha
// assegnato (masters.parent_listino_id, un listino_clienti). Sola lettura.
export async function GET(_req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ ereditato: false })
  const { data: utente } = await supabase.from('utenti').select('master_id').eq('id', user.id).single()
  if (!utente?.master_id) return NextResponse.json({ ereditato: false })

  const admin = createAdminSupabase()
  const { data: m } = await admin.from('masters').select('parent_master_id,parent_listino_id').eq('id', utente.master_id).maybeSingle()
  if (!m?.parent_listino_id) return NextResponse.json({ ereditato: false })
  // Solo i rivenditori puri sono in sola lettura; il titolare dei contratti (es. E&A) resta editabile.
  const { listinoCorrieriSolaLettura } = await import('@/lib/rete-masters')
  if (!(await listinoCorrieriSolaLettura(admin, utente.master_id))) return NextResponse.json({ ereditato: false })

  const listinoId = m.parent_listino_id
  const [{ data: fasce }, { data: suppl }, { data: listino }] = await Promise.all([
    admin.from('listini_clienti_fasce').select('corriere_id,peso_max,prezzo,tipo,zona_id,zone(nome),corrieri(nome_contratto)').eq('listino_id', listinoId).order('peso_max'),
    admin.from('listini_clienti_supplementi').select('corriere_id,tipo,nome,valore,descrizione').eq('listino_id', listinoId).in('tipo', ['contrassegno', 'assicurazione', 'giacenza', 'giacenza_apertura', 'accessorio']),
    admin.from('listini_clienti').select('nome').eq('id', listinoId).maybeSingle(),
  ])

  // Raggruppa per corriere -> zona -> fasce peso
  const corrieri: Record<string, any> = {}
  for (const f of (fasce || [])) {
    const cid = f.corriere_id || 'na'
    const cnome = (f as any).corrieri?.nome_contratto || 'Corriere'
    const znome = (f as any).zone?.nome || 'Italia'
    if (!corrieri[cid]) corrieri[cid] = { corriere: cnome, zone: {} }
    if (!corrieri[cid].zone[znome]) corrieri[cid].zone[znome] = []
    corrieri[cid].zone[znome].push({ peso_max: Number(f.peso_max), prezzo: Number(f.prezzo), tipo: f.tipo })
  }

  return NextResponse.json({
    ereditato: true,
    listinoNome: listino?.nome || 'Listino assegnato',
    corrieri: Object.values(corrieri),
    supplementi: (suppl || []).map((s: any) => {
      let d: any = null; try { d = JSON.parse(s.descrizione) } catch {}
      return { corriere_id: s.corriere_id, tipo: s.tipo, nome: s.nome, valore: Number(s.valore) || 0, perc: Number(d?.perc) || 0, valore_max: Number(d?.valore_max) || 0 }
    }),
  })
}
