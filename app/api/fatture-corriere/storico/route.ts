import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { utenteDetentore } from '@/lib/controllo-fattura-accesso'

// LO STORICO DELLE FATTURE DEL CORRIERE, mese per mese, solo quelle del master che chiede.
//   GET            → l'elenco, con quanto è stato girato ai clienti con la Rettifica e quanto resta a suo carico
//   GET ?fattura=  → una fattura con tutte le righe, per riaprirla senza ricaricare il file
export async function GET(req: NextRequest) {
  const u = await utenteDetentore(); if (u.errore) return u.errore
  const admin = createAdminSupabase()
  const id = req.nextUrl.searchParams.get('fattura')

  if (id) {
    const { data: f } = await admin.from('fatture_corriere').select('*').eq('id', id).maybeSingle()
    if (!f || f.master_id !== u.masterId) return NextResponse.json({ error: 'Fattura non trovata.' }, { status: 404 })
    const esiti: any[] = []
    for (let da = 0; ; da += 1000) {
      const { data, error } = await admin.from('fatture_corriere_righe').select('esito').eq('fattura_id', id).order('id').range(da, da + 999)
      if (error) return NextResponse.json({ error: 'Lettura righe non riuscita: ' + error.message }, { status: 500 })
      esiti.push(...(data || []).map((r: any) => r.esito)); if ((data || []).length < 1000) break
    }
    return NextResponse.json({ fattura: f, esiti })
  }

  const { data: fatture, error } = await admin.from('fatture_corriere')
    .select('id,corriere_id,nome_contratto,numero_fattura,data_fattura,nome_file,stato,righe,andate,rientri,totale_corriere,totale_trovate,costo_moove,differenza,non_trovate,totale_non_trovate,da_girare,euro_da_girare,rettifiche_file_id,created_at')
    .eq('master_id', u.masterId).eq('stato', 'completa').order('data_fattura', { ascending: false }).order('created_at', { ascending: false }).limit(240)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Quanto è stato davvero girato ai clienti: le rettifiche nate da "Manda alla Rettifica" su quella fattura,
  // separate fra confermate (soldi mossi) e ancora da confermare. La differenza è negativa = addebito.
  const fileIds = (fatture || []).map((f: any) => f.rettifiche_file_id).filter(Boolean)
  const perFile = new Map<string, { inviate: number; confermate: number; euroConfermati: number; euroInAttesa: number }>()
  for (let i = 0; i < fileIds.length; i += 100) {
    const { data } = await admin.from('rettifiche').select('file_id,confermata,differenza,fuori_sagoma')
      .eq('master_id', u.masterId).in('file_id', fileIds.slice(i, i + 100)).or('propagazione.is.null,propagazione.neq.annullata')
    for (const r of data || []) {
      const v = perFile.get(r.file_id) || { inviate: 0, confermate: 0, euroConfermati: 0, euroInAttesa: 0 }
      const euro = -(Number(r.differenza) || 0) + (Number(r.fuori_sagoma) || 0)
      v.inviate++
      if (r.confermata) { v.confermate++; v.euroConfermati += euro } else v.euroInAttesa += euro
      perFile.set(r.file_id, v)
    }
  }
  const r2 = (n: number) => Math.round(n * 100) / 100
  return NextResponse.json({
    fatture: (fatture || []).map((f: any) => {
      const g = f.rettifiche_file_id ? perFile.get(f.rettifiche_file_id) : null
      const recuperato = r2(g?.euroConfermati || 0)
      return { ...f, girate: g ? { ...g, euroConfermati: recuperato, euroInAttesa: r2(g.euroInAttesa) } : null, aTuoCarico: r2(Number(f.differenza) - recuperato) }
    }),
  })
}
