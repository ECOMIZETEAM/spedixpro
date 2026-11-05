import { NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'

// Da quando il caricamento confronta le righe con OneTracking (lib/ripesature-controllo, acceso il 05/11/2026): i file
// di prima non hanno l'esito, inutile andarlo a cercare.
const CONTROLLO_DAL = '2026-11-05'

export async function GET() {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json([])
  const { data: utente } = await supabase.from('utenti').select('master_id').eq('id', user.id).single()
  const { data } = await supabase.from('rettifiche_files')
    .select('*')
    .eq('master_id', utente?.master_id)
    .order('created_at', { ascending: false })
    .limit(20)
  const files = (data || []) as any[]
  // IL CONTROLLO ONETRACKING DI OGNI FILE: quante righe OneTracking conferma, quante ha fermato (e perche'), quante non
  // erano misurate da Poste. Si conta riga per riga dall'esito scritto al caricamento, confermate comprese.
  for (const f of files) {
    if (String(f.created_at || '') < CONTROLLO_DAL) continue
    const conta: Record<string, number> = {}
    for (let da = 0; ; da += 1000) {
      const { data: rr, error } = await supabase.from('rettifiche').select('stato,esito:controllo->>esito')
        .eq('file_id', f.id).not('controllo', 'is', null).order('id').range(da, da + 999)
      if (error) break
      for (const r of (rr || []) as any[]) {
        conta[r.esito] = (conta[r.esito] || 0) + 1
        if ((r.esito === 'senza_agevolazione' || r.esito === 'peso_sbagliato') && r.stato !== 'in_contestazione') conta.caricate_lo_stesso = (conta.caricate_lo_stesso || 0) + 1
      }
      if (!rr || rr.length < 1000) break
    }
    if (Object.keys(conta).length) f.onetracking = conta
  }
  return NextResponse.json(files)
}