import { createServerSupabase } from '@/lib/supabase'
import { redirect } from 'next/navigation'
import ListinoEditor from './ListinoEditor'

export default async function ModificaListinoPage({
  params, searchParams
}: {
  params: Promise<{id:string}>
  searchParams: Promise<{corriere?:string; preventivo?:string}>
}) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/')
  const { id } = await params
  const { corriere: corriereQuery, preventivo: preventivoId } = await searchParams
  const { data: utente } = await supabase.from('utenti').select('master_id').eq('id', user.id).single()
  const { data: listino } = await supabase.from('listini_clienti').select('*').eq('id', id).single()
  if (!listino) redirect('/dashboard/listini')
  let { data: corrieriAssegnati } = await supabase.from('listini_clienti_corrieri')
    .select('corriere_id, corrieri(id,nome_contratto)')
    .eq('listino_id', id)
  let corrieri = (corrieriAssegnati||[]).map((r:any) => r.corrieri).filter(Boolean)

  if (!corrieri.length) {
    const { data: corriereIdsStorici } = await supabase.from('listini_clienti_fasce')
      .select('corriere_id').eq('listino_id', id)
    const idsUnici = Array.from(new Set((corriereIdsStorici||[]).map((r:any) => r.corriere_id).filter(Boolean)))
    if (idsUnici.length) {
      await supabase.from('listini_clienti_corrieri').insert(
        idsUnici.map((corriere_id:any) => ({ listino_id: id, corriere_id }))
      )
      const { data: corrieriStorici } = await supabase.from('corrieri').select('id,nome_contratto').in('id', idsUnici)
      corrieri = corrieriStorici || []
    }
  }

  const { data: tuttiICorrieri } = await supabase.from('corrieri').select('id,nome_contratto').eq('master_id', utente?.master_id)
  // Mostra solo i corrieri POSSEDUTI dal master (no residui estranei da duplicazioni).
  const posseduti = new Set((tuttiICorrieri||[]).map((c:any) => c.id))
  corrieri = corrieri.filter((c:any) => posseduti.has(c.id))
  const corrieriDisponibiliDaAggiungere = (tuttiICorrieri||[]).filter(c => !corrieri.some((x:any) => x.id === c.id))
  const corriereSelezionato = corrieri?.find((c:any) => c.id === corriereQuery) || corrieri?.[0]
  const { data: zone } = await supabase.from('zone').select('id,nome').eq('master_id', utente?.master_id).eq('corriere_id', corriereSelezionato?.id||'').order('nome')
  const { data: fasceEsistenti } = await supabase.from('listini_clienti_fasce').select('*').eq('listino_id', id).eq('corriere_id', corriereSelezionato?.id||'').order('peso_max')
  const { data: supplementiEsistenti } = await supabase.from('listini_clienti_supplementi').select('*').eq('listino_id', id).eq('corriere_id', corriereSelezionato?.id||'')
  const { data: clientiAssegnati } = await supabase.from('clienti').select('id,ragione_sociale,email').eq('listino_cliente_id', id)
  // Fattore volume del corriere selezionato (per-corriere)
  const { data: aggSel } = await supabase.from('listini_clienti_corrieri').select('fattore_volume').eq('listino_id', id).eq('corriere_id', corriereSelezionato?.id||'').maybeSingle()
  const fattoreCorriere = (aggSel?.fattore_volume != null) ? aggSel.fattore_volume : (listino.fattore_volume ?? 5000)

  // IL MIO COSTO per lo stesso corriere, dal Listino Corrieri del master. Serve all'editor per
  // segnalare le caselle in cui si sta vendendo sotto costo. Le fasce di TUTTI i contratti stanno
  // sotto i listini del master e si distinguono per corriere_id, quindi si filtra per quello.
  const costiMaster: Record<string, number> = {}
  if (corriereSelezionato?.id && utente?.master_id) {
    const { data: listiniCorr } = await supabase.from('listini_corrieri').select('id').eq('master_id', utente.master_id)
    const idsCorr = (listiniCorr || []).map((l: any) => l.id)
    if (idsCorr.length) {
      const { data: fasceCosto } = await supabase.from('listini_corrieri_fasce')
        .select('zona_id,peso_max,prezzo,tipo')
        .in('listino_id', idsCorr)
        .eq('corriere_id', corriereSelezionato.id)
      for (const f of fasceCosto || []) {
        const chiave = `${f.tipo || 'fino_a'}|${Number(f.peso_max)}|${f.zona_id}`
        const p = Number(f.prezzo)
        // Piu' listini del master possono avere la stessa fascia: si tiene il costo PIU' ALTO,
        // cioe' il caso peggiore. Segnalare troppo poco sarebbe inutile.
        if (!isNaN(p) && (costiMaster[chiave] == null || p > costiMaster[chiave])) costiMaster[chiave] = p
      }
    }
  }

  return (
    <>
    {preventivoId && (
      <div style={{margin:'0 0 14px',background:'#fff7ed',border:'1px solid #fed7aa',borderRadius:'8px',padding:'10px 14px',display:'flex',alignItems:'center',justifyContent:'space-between',gap:'10px',flexWrap:'wrap'}}>
        <span style={{fontSize:'13px',color:'#9a3412'}}>Stai compilando i <b>prezzi di un preventivo</b>. Aggiungi corrieri, zone e supplementi, poi torna al preventivo.</span>
        <a href={`/dashboard/preventivi/${preventivoId}`} style={{background:'#ea580c',color:'#fff',borderRadius:'6px',padding:'7px 14px',fontSize:'12.5px',fontWeight:700,textDecoration:'none',whiteSpace:'nowrap'}}>← Torna al preventivo</a>
      </div>
    )}
    <ListinoEditor
      listino={listino}
      corrieri={corrieri||[]}
      corrieriDisponibili={corrieriDisponibiliDaAggiungere||[]}
      corriereSelezionatoId={corriereSelezionato?.id||''}
      fattoreCorriere={fattoreCorriere}
      zone={zone||[]}
      fasceEsistenti={fasceEsistenti||[]}
      supplementiEsistenti={supplementiEsistenti||[]}
      clientiAssegnati={clientiAssegnati||[]}
      costiMaster={costiMaster}
      tipoListino="cliente"
    />
    </>
  )
}