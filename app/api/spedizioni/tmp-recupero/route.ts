import { NextRequest, NextResponse } from 'next/server'
import { bloccaCronNonAutorizzato } from '@/lib/cron-auth'
import { createAdminSupabase } from '@/lib/supabase-admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

// RECUPERO DELLE SPEDIZIONI FERME SU UN NUMERO PROVVISORIO.
//
// Sui contratti DVA la lettera di vettura non arriva insieme all'ordine: l'ordine si paga, e il
// numero con le etichette si va a prendere dopo. Se in quel momento non c'e' ancora, la spedizione
// viene salvata con un numero provvisorio "TMP-<ordine>" — senza un numero non sarebbe agganciabile
// ai movimenti — e dovrebbe essere completata piu' tardi.
//
// Piu' tardi non arrivava mai: due spedizioni sono rimaste col TMP per otto ore, e con loro le
// ETICHETTE, che il provider aveva gia' pronte. Un pacco senza etichetta non parte.
//
// Questo lavoro fa solo quello, e solo su quelle: cerca le spedizioni il cui numero comincia per
// TMP-, richiede la waybill, e quando c'e' scrive numero ed etichette. NON tocca nient'altro —
// nessun'altra spedizione, nessun altro corriere, nessun prezzo, nessun movimento. E' scritto
// apposta come lavoro a parte invece che dentro la creazione: li' passano 1.500 pacchi al giorno
// di tutti i contratti, e un errore avrebbe conseguenze su tutti.
export async function GET(req: NextRequest) {
  const _cron = bloccaCronNonAutorizzato(req); if (_cron) return _cron
  const admin = createAdminSupabase()

  // SOLO chi ha il numero provvisorio, e solo sul contratto che lo produce.
  const { data: ferme } = await admin.from('spedizioni')
    .select('id,numero,colli,corriere_id,stato,colli_dettaglio,created_at,corrieri(tipo,credenziali)')
    .like('numero', 'TMP-%')
    .not('stato', 'in', '(annullata,annullamento_manuale)')
    // Oltre una settimana la lettera di vettura non arriva piu': quella spedizione va guardata a
    // mano, non ritentata all'infinito. Il limite tiene anche la ricerca leggera su una tabella
    // che cresce di 1.500 righe al giorno.
    .gte('created_at', new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString())
    .order('created_at', { ascending: true })
    .limit(50)

  let completate = 0, soloEtichette = 0, ancoraNulla = 0, saltate = 0
  const { easyparcelWaybill, unisciEtichette } = await import('@/lib/easyparcel')

  for (const s of (ferme || [])) {
    const corr: any = (s as any).corrieri
    // Il numero provvisorio nasce solo sul ramo DVA: su qualsiasi altro tipo non si tocca niente.
    if (corr?.tipo !== 'easyparcel') { saltate++; continue }
    const apikey = corr?.credenziali?.apikey
    if (!apikey) { saltate++; continue }

    const ordine = String(s.numero).replace(/^TMP-/, '')
    let w: any = null
    try {
      w = await easyparcelWaybill(apikey, ordine)
    } catch (e: any) {
      console.warn('[TMP] waybill non ancora disponibile', s.numero, e?.message)
      ancoraNulla++
      continue
    }

    const patch: any = {}

    // LE ETICHETTE SI SALVANO ANCHE SENZA LETTERA DI VETTURA.
    // Sono valide di per se': il pacco con quelle parte. Buttarle perche' manca un altro campo
    // e' il motivo per cui questi pacchi sono rimasti fermi.
    const singole: string[] = (w?.singole || []).map((x: any) => x?.pdfBase64).filter(Boolean)
    if (singole.length) {
      const unito = (await unisciEtichette(singole)) || w?.pdfBase64
      if (unito) patch.etichetta_url = `data:application/pdf;base64,${unito}`
      const dett = Array.isArray(s.colli_dettaglio) ? [...s.colli_dettaglio] : []
      if (dett.length) {
        for (let i = 0; i < dett.length; i++) {
          if (singole[i]) dett[i] = { ...dett[i], etichetta_url: `data:application/pdf;base64,${singole[i]}` }
        }
        patch.colli_dettaglio = dett
      }
    } else if (w?.pdfBase64) {
      patch.etichetta_url = `data:application/pdf;base64,${w.pdfBase64}`
    }

    // IL NUMERO si cambia solo se la LDV c'e' davvero ed e' diversa. Un numero e' l'identita' della
    // spedizione: sta nei movimenti, nelle distinte, sull'etichetta gia' stampata. Non si tocca
    // per un valore vuoto o dubbio.
    const ldv = String(w?.ldv || '').trim()
    if (ldv && ldv !== s.numero) {
      // Se quel numero esiste gia' su un'altra spedizione, non si sovrascrive niente: si segnala.
      const { data: gia } = await admin.from('spedizioni').select('id').eq('numero', ldv).neq('id', s.id).maybeSingle()
      if (gia) {
        console.error('[TMP] LDV gia in uso da un altra spedizione, non riassegnata', ldv, s.numero)
      } else {
        patch.numero = ldv
        patch.tracking_number = ldv
      }
    }
    // Il codice di ritiro NON si scrive qui: vive sulla riga del ritiro, non sulla spedizione, e
    // ha gia' il suo recupero. Toccarlo da qui vorrebbe dire scrivere su una colonna che non esiste.

    if (!Object.keys(patch).length) { ancoraNulla++; continue }
    const { error } = await admin.from('spedizioni').update(patch).eq('id', s.id)
    if (error) { console.error('[TMP] aggiornamento fallito', s.numero, error.message); continue }

    if (patch.numero) { completate++; console.log('[TMP] completata', s.numero, '->', patch.numero) }
    else { soloEtichette++; console.log('[TMP] recuperate solo le etichette', s.numero) }
  }

  return NextResponse.json({
    esaminate: (ferme || []).length,
    completate,            // numero provvisorio sostituito con la LDV vera
    soloEtichette,         // etichette recuperate, la LDV non c'e' ancora
    ancoraNulla,           // il provider non ha ancora niente
    saltate,               // non e' un contratto che produce numeri provvisori
  })
}
