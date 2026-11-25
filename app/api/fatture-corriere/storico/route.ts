import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { utenteDetentore } from '@/lib/controllo-fattura-accesso'
import { fatturaConAzioni } from '@/lib/controllo-fattura-riepilogo'

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
    .select('id,corriere_id,nome_contratto,numero_fattura,etichetta,data_fattura,nome_file,stato,righe,andate,rientri,totale_corriere,totale_trovate,costo_moove,differenza,non_trovate,totale_non_trovate,da_girare,euro_da_girare,rettifiche_file_id,riepilogo,created_at')
    .eq('master_id', u.masterId).eq('stato', 'completa').order('data_fattura', { ascending: false }).order('created_at', { ascending: false }).limit(240)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Quanto è stato davvero girato ai clienti, separato fra confermate (soldi mossi) e ancora da confermare. Le
  // rettifiche della fattura sono quelle nate da "Manda alla Rettifica" (il suo file) più quelle fatte con un file
  // proprio nella pagina Rettifica sulle sue spedizioni (riepilogo.rettificheEsterne): una rettifica che sta in
  // tutte e due si conta una volta. La differenza è negativa = addebito.
  const fileIds = Array.from(new Set((fatture || []).map((f: any) => f.rettifiche_file_id).filter(Boolean))) as string[]
  const esterneIds = Array.from(new Set((fatture || []).flatMap((f: any) => Array.isArray(f.riepilogo?.rettificheEsterne?.ids) ? f.riepilogo.rettificheEsterne.ids : []))) as string[]
  // Per la fattura aperta (`?aperta=`) anche le spedizioni rettificate: la pagina ci trova quelle da girare
  // rimaste fuori dalla Rettifica, e dice quali sono e perché.
  const aperta = req.nextUrl.searchParams.get('aperta')
  type Rett = { id: string; file_id: string | null; spedizione_id: string | null; confermata: boolean; euro: number }
  const perId = new Map<string, Rett>()
  const leggi = async (campo: 'file_id' | 'id', valori: string[]) => {
    for (let i = 0; i < valori.length; i += 100) {
      for (let da = 0; ; da += 1000) {
        const { data, error } = await admin.from('rettifiche').select('id,file_id,spedizione_id,confermata,differenza,fuori_sagoma')
          .eq('master_id', u.masterId).in(campo, valori.slice(i, i + 100)).or('propagazione.is.null,propagazione.neq.annullata').order('id').range(da, da + 999)
        if (error) throw new Error(error.message)
        for (const r of data || []) perId.set(r.id, { id: r.id, file_id: r.file_id, spedizione_id: r.spedizione_id, confermata: !!r.confermata, euro: -(Number(r.differenza) || 0) + (Number(r.fuori_sagoma) || 0) })
        if ((data || []).length < 1000) break
      }
    }
  }
  try { await leggi('file_id', fileIds); await leggi('id', esterneIds) }
  catch (e: any) { return NextResponse.json({ error: 'Lettura delle rettifiche non riuscita: ' + String(e?.message || e) }, { status: 500 }) }
  const r2 = (n: number) => Math.round(n * 100) / 100
  return NextResponse.json({
    fatture: (fatture || []).filter(fatturaConAzioni).map((f: any) => {
      const sue = new Map<string, Rett>()
      if (f.rettifiche_file_id) for (const r of perId.values()) if (r.file_id === f.rettifiche_file_id) sue.set(r.id, r)
      for (const id of f.riepilogo?.rettificheEsterne?.ids || []) { const r = perId.get(id); if (r) sue.set(id, r) }
      const g = sue.size || f.rettifiche_file_id ? { inviate: 0, confermate: 0, euroConfermati: 0, euroInAttesa: 0 } : null
      for (const r of sue.values()) { g!.inviate++; if (r.confermata) { g!.confermate++; g!.euroConfermati += r.euro } else g!.euroInAttesa += r.euro }
      const recuperato = r2(g?.euroConfermati || 0)
      // Gli id delle rettifiche servono solo qui: nell'elenco non viaggiano.
      const riepilogo = f.riepilogo ? { ...f.riepilogo, rettificheEsterne: undefined } : f.riepilogo
      const spedizioni = f.id === aperta ? Array.from(new Set(Array.from(sue.values()).map(r => r.spedizione_id).filter(Boolean))) : undefined
      return { ...f, riepilogo, girate: g ? { ...g, euroConfermati: recuperato, euroInAttesa: r2(g.euroInAttesa), ...(spedizioni ? { spedizioni } : {}) } : null, aTuoCarico: r2(Number(f.differenza) - recuperato) }
    }),
  })
}

// IL NOME DELLA FATTURA NELLO STORICO ("BRT W settembre"): lo dà il detentore, solo alle sue. Il numero di
// BRT non si tocca: è quello che impedisce di caricare due volte la stessa fattura.
export async function POST(req: NextRequest) {
  const u = await utenteDetentore(); if (u.errore) return u.errore
  const corpo = await req.json().catch(() => ({})) as { fattura?: string; etichetta?: string | null }
  const admin = createAdminSupabase()
  const { data: f } = await admin.from('fatture_corriere').select('id,master_id').eq('id', String(corpo.fattura || '')).maybeSingle()
  if (!f || f.master_id !== u.masterId) return NextResponse.json({ error: 'Fattura non trovata.' }, { status: 404 })
  const etichetta = String(corpo.etichetta ?? '').replace(/\s+/g, ' ').trim().slice(0, 80) || null
  const { error } = await admin.from('fatture_corriere').update({ etichetta }).eq('id', f.id)
  if (error) return NextResponse.json({ error: 'Nome non salvato: ' + error.message }, { status: 500 })
  return NextResponse.json({ ok: true, etichetta })
}
