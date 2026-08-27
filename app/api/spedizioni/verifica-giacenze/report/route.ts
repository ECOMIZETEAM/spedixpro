import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'

// REPORT del controllo agente giacenze — SOLO super master (è il suo monitoraggio, globale su tutta
// la rete, non dei singoli master). Legge l'esito già salvato dal cron (giacenza_verifica_*): nessun
// corriere richiamato all'apertura, quindi è veloce.
export async function GET(_req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('master_id').eq('id', user.id).single()
  if (!utente?.master_id) return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  const admin = createAdminSupabase()
  const { data: m } = await admin.from('masters').select('is_super_master').eq('id', utente.master_id).single()
  if (!m?.is_super_master) return NextResponse.json({ error: 'Sezione riservata al super master' }, { status: 403 })

  // TUTTE le svincolate (fetchAll: oltre 1000 verrebbero troncate e i conteggi uscirebbero sbagliati).
  const rows: any[] = []
  for (let off = 0; ; off += 1000) {
    const { data } = await admin.from('spedizioni')
      .select('numero,tracking_number,giacenza_stato,giacenza_data,giacenza_verifica_esito,giacenza_verifica_at,giacenza_motivo,corrieri(tipo,nome_contratto),clienti(ragione_sociale),masters:master_id(nome)')
      .eq('giacenza_stato', 'svincolata')
      .order('giacenza_verifica_at', { ascending: false, nullsFirst: false })
      .range(off, off + 999)
    if (!data || !data.length) break
    rows.push(...data)
    if (data.length < 1000) break
  }

  const oggi = new Date().toISOString().slice(0, 10)
  // Super master = E&A: qui i nomi dei fornitori possono comparire (unica eccezione delle regole,
  // è il suo monitoraggio interno). Servono a sapere su QUALE portale corriere andare a guardare.
  const nomeProv: Record<string, string> = { spediamopro: 'SpediamoPro', easyparcel: 'DVA', spedisci: 'Spedisci', gls: 'GLS', interno: 'Interno' }
  const perCorriere: Record<string, { ok: number; ferma: number; errore: number; nonVerificate: number }> = {}
  let ok = 0, ferma = 0, errore = 0, nonVerificate = 0, controllateOggi = 0
  const problemi: any[] = []

  for (const r of rows) {
    const prov = nomeProv[r.corrieri?.tipo] || r.corrieri?.tipo || '—'
    perCorriere[prov] ??= { ok: 0, ferma: 0, errore: 0, nonVerificate: 0 }
    const es = r.giacenza_verifica_esito as string | null
    if (r.giacenza_verifica_at && String(r.giacenza_verifica_at).slice(0, 10) === oggi) controllateOggi++
    if (es === 'ok') { ok++; perCorriere[prov].ok++ }
    else if (es === 'ferma') {
      ferma++; perCorriere[prov].ferma++
      problemi.push({
        ldv: r.numero || r.tracking_number, corriere: prov,
        cliente: r.clienti?.ragione_sociale || '—', master: r.masters?.nome || '—',
        in_giacenza_dal: r.giacenza_data, controllata: r.giacenza_verifica_at, motivo: r.giacenza_motivo || null,
      })
    }
    else if (es === 'errore') { errore++; perCorriere[prov].errore++ }
    else { nonVerificate++; perCorriere[prov].nonVerificate++ }
  }

  return NextResponse.json({
    totaliSvincolate: rows.length,
    ok, ferma, errore, nonVerificate, controllateOggi,
    perCorriere,
    problemi: problemi.sort((a, b) => (a.controllata < b.controllata ? 1 : -1)),
  })
}
