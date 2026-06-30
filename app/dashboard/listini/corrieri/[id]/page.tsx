import { createServerSupabase } from '@/lib/supabase'
import { redirect } from 'next/navigation'
import ListinoEditor from '../../clienti/[id]/ListinoEditor'

export default async function ModificaListinoCorrierePage({
  params, searchParams
}: {
  params: Promise<{id:string}>
  searchParams: Promise<{corriere?:string}>
}) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/')
  const { id } = await params
  const { corriere: corriereQuery } = await searchParams
  const { data: utente } = await supabase.from('utenti').select('master_id').eq('id', user.id).single()
  const { data: listino } = await supabase.from('listini_corrieri').select('*').eq('id', id).single()
  if (!listino) redirect('/dashboard/listini')
  let { data: corrieriAssegnati } = await supabase.from('listini_corrieri_corrieri')
    .select('corriere_id, corrieri(id,nome_contratto)')
    .eq('listino_id', id)
  let corrieri = (corrieriAssegnati||[]).map((r:any) => r.corrieri).filter(Boolean)

  if (!corrieri.length) {
    const { data: corriereIdsStorici } = await supabase.from('listini_corrieri_fasce')
      .select('corriere_id').eq('listino_id', id)
    const idsUnici = Array.from(new Set((corriereIdsStorici||[]).map((r:any) => r.corriere_id).filter(Boolean)))
    if (idsUnici.length) {
      await supabase.from('listini_corrieri_corrieri').insert(
        idsUnici.map((corriere_id:any) => ({ listino_id: id, corriere_id }))
      )
      const { data: corrieriStorici } = await supabase.from('corrieri').select('id,nome_contratto').in('id', idsUnici)
      corrieri = corrieriStorici || []
    }
  }

  const { data: tuttiICorrieri } = await supabase.from('corrieri').select('id,nome_contratto').eq('master_id', utente?.master_id)
  const corrieriDisponibiliDaAggiungere = (tuttiICorrieri||[]).filter(c => !corrieri.some((x:any) => x.id === c.id))
  const corriereSelezionato = corrieri?.find((c:any) => c.id === corriereQuery) || corrieri?.[0]
  const { data: zone } = await supabase.from('zone').select('id,nome').eq('master_id', utente?.master_id).eq('corriere_id', corriereSelezionato?.id||'').order('nome')
  const { data: fasceEsistenti } = await supabase.from('listini_corrieri_fasce').select('*').eq('listino_id', id).eq('corriere_id', corriereSelezionato?.id||'').order('peso_max')
  const { data: supplementiEsistenti } = await supabase.from('listini_corrieri_supplementi').select('*').eq('listino_id', id).eq('corriere_id', corriereSelezionato?.id||'')
  const { data: aggSel } = await supabase.from('listini_corrieri_corrieri').select('fattore_volume').eq('listino_id', id).eq('corriere_id', corriereSelezionato?.id||'').maybeSingle()
  const fattoreCorriere = (aggSel?.fattore_volume != null) ? aggSel.fattore_volume : (listino.fattore_volume ?? 5000)
  return (
    <ListinoEditor
      listino={listino}
      corrieri={corrieri||[]}
      corrieriDisponibili={corrieriDisponibiliDaAggiungere||[]}
      corriereSelezionatoId={corriereSelezionato?.id||''}
      fattoreCorriere={fattoreCorriere}
      zone={zone||[]}
      fasceEsistenti={fasceEsistenti||[]}
      supplementiEsistenti={supplementiEsistenti||[]}
      clientiAssegnati={[]}
      tipoListino="corriere"
    />
  )
}