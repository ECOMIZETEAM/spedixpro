import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { vedeLaRete } from '@/lib/ruoli'
import { isAgente } from '@/lib/agente'
import { FERMA } from '@/lib/ripesature-controllo'
import { perchePropri } from '@/lib/rettifiche-perche'

// DOVE SONO FINITE LE RIGHE DI UN FILE (Lorenzo, 05/11/2026: «se carico un file da 1000 rettifiche me le divide facendomi
// capire e fine.. poi rimangono solo quelle da addebitare. L'importante che faccia capire il perchè da 1000 so rimaste 300
// da addebitare e le 700 che fine hanno fatto»). Ogni spedizione del file sta in UN blocco, e i blocchi fanno il totale:
// le righe diventate rettifiche si contano dalle righe (master_id = chi guarda), quelle che non lo sono diventate dai conti
// che il caricamento scrive in rettifiche_files.esito. Per i file di prima del 05/11 quei conti non ci sono: si dice.
export const maxDuration = 60

type Blocco = { chiave: string; titolo: string; n: number; euro?: number; fare: string; tono: 'verde' | 'rosso' | 'grigio' | 'giallo' }

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo').eq('id', user.id).single()
  if (!utente?.master_id || !vedeLaRete(utente as any) || isAgente(utente as any)) return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  const mio = utente.master_id
  const fileId = req.nextUrl.searchParams.get('fileId')
  if (!fileId) return NextResponse.json({ error: 'File mancante' }, { status: 400 })
  const admin = createAdminSupabase()
  const { data: file } = await admin.from('rettifiche_files').select('*').eq('id', fileId).eq('master_id', mio).maybeSingle()
  if (!file) return NextResponse.json({ error: 'File non trovato' }, { status: 404 })

  const righe: any[] = []
  for (let da = 0; ; da += 1000) {
    const { data, error } = await admin.from('rettifiche')
      .select('id,spedizione_id,numero_spedizione,stato,confermata,master_id,target_master_id,differenza,fuori_sagoma,costo_fornitore,controllo,perche,peso_reale,peso_volume_reale,supplementi_nomi,rif_fornitore')
      .eq('file_id', fileId).eq('master_id', mio).order('id').range(da, da + 999)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    righe.push(...(data || [])); if (!data || data.length < 1000) break
  }
  const r2 = (n: number) => Math.round(n * 100) / 100
  const addebito = (r: any) => Math.max(0, -Number(r.differenza || 0) + Number(r.fuori_sagoma || 0))
  const soloMie = righe.filter(r => r.target_master_id && r.target_master_id === r.master_id)
  const perche = soloMie.length ? await perchePropri(admin, mio, soloMie) : new Map()
  const conta = (lst: any[], euro?: (r: any) => number) => ({ n: lst.length, ...(euro ? { euro: r2(lst.reduce((t, r) => t + euro(r), 0)) } : {}) })
  const sotto = righe.filter(r => !(r.target_master_id && r.target_master_id === r.master_id))
  const ferme = sotto.filter(r => r.stato === 'in_contestazione')
  const vive = sotto.filter(r => r.stato !== 'in_contestazione' && r.stato !== 'annullata')
  const tipo = (r: any) => perche.get(r.id)?.tipo || 'stesso_prezzo'
  const e: any = file.esito || null
  const n = (k: string) => Number(e?.[k]) || 0
  const costo = (r: any) => Number(r.costo_fornitore || 0)

  const blocchi: Blocco[] = [
    { chiave: 'da_addebitare', titolo: 'Da addebitare', ...conta(vive.filter(r => !r.confermata), addebito), tono: 'verde',
      fare: 'Sono nell\'elenco qui sotto: selezionale e premi Conferma.' },
    { chiave: 'addebitate', titolo: 'Già addebitate (confermate)', ...conta(vive.filter(r => r.confermata), addebito), tono: 'verde',
      fare: 'Fatto: chi sta sotto le ha già pagate.' },
    { chiave: 'ferme_agev', titolo: 'Ferme: senza agevolazione peso reale', ...conta(ferme.filter(r => r.controllo?.esito === 'senza_agevolazione'), costo), tono: 'rosso',
      fare: 'Per Poste il pacco stava nella scatola: si paga il peso reale. Da contestare al fornitore; sotto non scende niente.' },
    { chiave: 'ferme_peso', titolo: 'Ferme: peso diverso dalla misura di Poste', ...conta(ferme.filter(r => r.controllo?.esito === 'peso_sbagliato'), costo), tono: 'rosso',
      fare: 'Il file fa pagare più di quanto ha misurato Poste. Da contestare al fornitore; sotto non scende niente.' },
    { chiave: 'contestazione', titolo: 'In contestazione col fornitore', ...conta(ferme.filter(r => !FERMA.has(r.controllo?.esito)), costo), tono: 'rosso',
      fare: 'Ferme finché la contestazione non si chiude.' },
    { chiave: 'gia_pagate_sotto', titolo: 'Già fatte pagare prima', n: soloMie.filter(r => tipo(r) === 'gia_fatta_pagare').length + n('giaRettificateSenzaCosto'),
      euro: r2(soloMie.filter(r => tipo(r) === 'gia_fatta_pagare').reduce((t, r) => t + costo(r), 0)), tono: 'grigio',
      fare: 'Su questi pacchi chi sta sotto ha già pagato con un\'altra rettifica: non si chiede due volte. Resta solo il tuo costo del fornitore.' },
    { chiave: 'niente_da_chiedere', titolo: 'Niente da chiedere sotto', n: soloMie.filter(r => tipo(r) === 'stesso_prezzo').length + n('nienteDaChiedere'),
      euro: r2(soloMie.filter(r => tipo(r) === 'stesso_prezzo').reduce((t, r) => t + costo(r), 0)), tono: 'grigio',
      fare: 'Col suo listino chi sta sotto ha già pagato quanto costa il pacco col peso nuovo: sulla riga ci sono i numeri.' },
    { chiave: 'senza_voce', titolo: 'Importi del fornitore senza voce', ...conta(soloMie.filter(r => tipo(r) === 'senza_voce'), costo), tono: 'giallo',
      fare: 'Il fornitore non dice per cosa li fa pagare: il portale non sa a chi girarli.' },
    { chiave: 'resi', titolo: 'Resi', n: soloMie.filter(r => tipo(r) === 'reso').length + n('resoSenzaCosto'),
      euro: r2(soloMie.filter(r => tipo(r) === 'reso').reduce((t, r) => t + costo(r), 0)), tono: 'grigio',
      fare: 'Il ritorno si paga col nolo del reso, non con la ripesatura.' },
    { chiave: 'gia_caricate', titolo: 'Già caricate con un file precedente', n: n('giaCaricate') + n('giaPagate') + n('doppioni'), tono: 'grigio',
      fare: 'Erano già entrate: non si ricaricano e non si pagano due volte.' },
    { chiave: 'non_trovate', titolo: 'Non trovate nel portale', n: n('nonTrovate'), tono: 'grigio',
      fare: 'Spedizioni fatte fuori dal portale o annullate: non c\'è niente da rettificare.' },
    { chiave: 'fuori_rete', titolo: 'Non della tua rete', n: n('fuoriCatena'), tono: 'grigio',
      fare: 'Il pacco non passa da te: non puoi rettificarlo tu.' },
    { chiave: 'attesa_misure', titolo: 'Più colli: in attesa delle misure', n: n('attesaMisure') + n('xlInAttesa'), tono: 'giallo',
      fare: 'Si aspettano le misure di tutti i colli: ricarica lo stesso file domani e si caricano per intero.' },
    { chiave: 'non_calcolabili', titolo: 'Non calcolabili col listino', n: n('nonCalcolabili'), tono: 'giallo',
      fare: 'Il listino di chi sta sotto non prezza quel pacco (destinazione o peso): va sistemato il listino.' },
  ]
  const totale = Number(e?.spedizioni) || Number(file.n_processate) || Number(file.n_tot_spedizioni) || 0
  if (!e) {
    // FILE DI PRIMA DEL 05/11/2026: i motivi non sono scritti, ma i numeri del registro li danno quasi tutti, perche' il
    // caricamento li ha sempre tenuti cosi': processate = tutte le spedizioni lette; trovate + scartate = quelle che ha
    // calcolato (le altre erano gia' caricate da un file precedente, o in attesa di misure nei file XL); scartate = non
    // trovate nel portale. mm.xlsx (05/11): 6.878 = 6.003 gia' caricate + 583 non trovate + 292 trovate.
    const P = Number(file.n_processate) || 0, T = Number(file.n_trovate) || 0, S = Number(file.n_scartati) || 0
    const gia = Math.max(0, P - T - S)
    if (gia) blocchi.push({ chiave: 'gia_caricate', titolo: 'Già caricate con un file precedente', n: gia, tono: 'grigio',
      fare: 'Erano già entrate: non si ricaricano e non si pagano due volte.' })
    if (S) blocchi.push({ chiave: 'non_trovate', titolo: 'Non trovate nel portale', n: S, tono: 'grigio',
      fare: 'Spedizioni fatte fuori dal portale o annullate: non c\'è niente da rettificare.' })
    const resto = Math.max(0, totale - blocchi.reduce((t, b) => t + b.n, 0))
    if (resto) blocchi.push({ chiave: 'senza_motivo', titolo: 'Trovate, ma senza niente da rettificare', n: resto, tono: 'grigio',
      fare: 'Fuori dalla tua rete, niente da chiedere sotto o già rettificate prima: per i file caricati prima del 05/11 il motivo preciso non è registrato.' })
  }
  const somma = blocchi.reduce((t, b) => t + b.n, 0)
  if (e && totale > somma) {
    blocchi.push({ chiave: 'altre', titolo: 'Altre', n: totale - somma, tono: 'grigio', fare: 'Righe del file che non sono diventate rettifiche per un motivo non contato.' })
  }
  return NextResponse.json({
    file: { id: file.id, nome: file.nome_file, quando: file.created_at },
    totale, righeNonSpedizione: Number(e?.righeNonSpedizione) || 0,
    blocchi: blocchi.filter(b => b.n > 0),
    conMotivi: !!e,
  })
}
