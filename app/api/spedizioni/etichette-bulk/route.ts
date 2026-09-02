import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { createHash } from 'node:crypto'
import { isAgente, clientiAgente, idClientiPerFiltro } from '@/lib/agente'
import { preparaRiepiloghi, disegnaRiepilogoSped } from '@/lib/riepilogo-ordine'

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('master_id,ruolo,cliente_id,nome,cognome').eq('id', user.id).single()
  const body = await req.json()
  const { ids } = body
  if (!ids?.length) return NextResponse.json({ error: 'Nessun ID' }, { status: 400 })

  const ruolo = (utente?.ruolo || '').toLowerCase()
  // Campi extra per l'eventuale "riepilogo ordine" (packing slip) da anteporre alle etichette.
  const cols = 'id,numero,etichetta_url,etichetta_path,raw_response,colli_dettaglio,cliente_id,created_at,rif_ordine,rif_destinatario,contenuto,colli,peso_reale,peso_fatturato,contrassegno,dest_nome,dest_indirizzo,dest_citta,dest_cap,dest_provincia,dest_paese,dest_telefono,mitt_nome,corriere_id,corrieri(nome_contratto)'
  let spedizioni: any[] | null = null
  const { createAdminSupabase } = await import('@/lib/supabase-admin')
  const admin = createAdminSupabase()
  if (ruolo === 'cliente') {
    const { data } = await supabase.from('spedizioni').select(cols).in('id', ids).eq('cliente_id', utente?.cliente_id)
    spedizioni = data
  } else {
    // Master: includi anche le spedizioni dei sotto-master della rete (stessa logica della lista)
    const { masterIdsVisibili } = await import('@/lib/rete-masters')
    const subtree = utente?.master_id ? await masterIdsVisibili(admin, utente.master_id) : []
    let q = admin.from('spedizioni').select(cols).in('id', ids).in('master_id', subtree.length ? subtree : ['00000000-0000-0000-0000-000000000000'])
    // Agente: solo etichette dei suoi clienti.
    if (isAgente(utente as any)) q = q.in('cliente_id', idClientiPerFiltro(await clientiAgente(supabase, utente as any)))
    const { data } = await q
    spedizioni = data
  }

  // ORDINE DEL PDF = ordine degli id RICEVUTI (= come appaiono in elenco): il DB con .in() li
  // restituisce in ordine arbitrario → le etichette uscivano mescolate rispetto alla selezione.
  const posizione = new Map<string, number>((ids as string[]).map((id: string, i: number) => [id, i]))
  spedizioni = (spedizioni || []).slice().sort((a: any, b: any) => (posizione.get(a.id) ?? 1e9) - (posizione.get(b.id) ?? 1e9))

  // Riepilogo ordine (packing slip): dati + drawer condivisi con la stampa singola.
  const riepCtx = await preparaRiepiloghi(admin, spedizioni || [])

  const pdfMerged = await PDFDocument.create()
  const font = await pdfMerged.embedFont(StandardFonts.Helvetica)
  const fontBold = await pdfMerged.embedFont(StandardFonts.HelveticaBold)

  for (const s of spedizioni || []) {
    // Etichette da stampare per questa spedizione. Sul MULTICOLLO ce n'e' una per collo; sul
    // monocollo il collo non la porta (sarebbe una copia identica) e si usa quella della spedizione.
    // ATTENZIONE: il ripiego DEVE dipendere dall'aver trovato o no delle etichette, non dal solo
    // fatto che colli_dettaglio esista. Con il controllo sbagliato una spedizione monocollo con
    // dettaglio colli valorizzato usciva dalla stampa SENZA ETICHETTA e senza alcun errore.
    const colli = (s.colli_dettaglio as any[]) || []
    const urls: string[] = []
    // UNA ETICHETTA UGUALE NON SI STAMPA DUE VOLTE.
    //
    // Alcuni contratti non mandano un'etichetta per collo: mandano UN SOLO PDF con dentro gia' una
    // pagina per ogni collo. La creazione lo copia identico su tutti i colli, e qui si finiva a
    // impilare N volte un documento che di pagine ne ha gia' N: una spedizione da 13 colli usciva
    // di 169 fogli invece di 13, e chi stampava se ne accorgeva dalla stampante.
    // Sono byte identici, quindi togliere i doppioni non fa perdere nulla: se le etichette sono
    // davvero diverse una per collo, restano tutte.
    const visti = new Set<string>()
    colli.forEach((c: any) => {
      if (!c.etichetta_url || visti.has(c.etichetta_url)) return
      visti.add(c.etichetta_url)
      urls.push(c.etichetta_url)
    })
    if (!urls.length && s.etichetta_url) urls.push(s.etichetta_url)

    // Forma nuova (PDF su Storage): non e' una stringa da decodificare, si scarica.
    const daStorage: Uint8Array[] = []
    if (!urls.length && (s as any).etichetta_path) {
      const { leggiEtichetta } = await import('@/lib/etichette')
      const et = await leggiEtichetta(admin, s as any)
      if (et) daStorage.push(new Uint8Array(et.buffer))
    }

    // RIPIEGO GLS: se non c'e' ancora nessuna etichetta (ne' inline ne' Storage) e la spedizione e' GLS
    // proprietaria, il PDF puo' non essere stato salvato alla creazione (GLS lo genera in ritardo dopo
    // AddParcel). Lo recuperiamo ORA da GLS e lo salviamo, esattamente come fa l'apertura singola: senza
    // questo, la stampa in blocco produceva il foglio "ETICHETTA NON DISPONIBILE" mentre aprendo la stessa
    // spedizione da sola l'etichetta si auto-riparava — incoerenza + rischio pacco GLS senza etichetta.
    if (!urls.length && !daStorage.length && (s as any).raw_response?._gls) {
      try {
        const { recuperaEtichettaGlsSalvando } = await import('@/lib/gls')
        const buf = await recuperaEtichettaGlsSalvando(admin, s as any)
        if (buf) daStorage.push(new Uint8Array(buf))
      } catch (e) { console.error('[ETICHETTE-BULK][GLS] recupero on-demand:', e) }
    }

    // Prima le pagine ETICHETTA...
    const sorgenti: Array<{ url?: string; bytes?: Uint8Array }> = [
      ...urls.map(u => ({ url: u })), ...daStorage.map(b => ({ bytes: b })),
    ]
    let stampate = 0
    // IL DOPPIONE SI RICONOSCE DAL CONTENUTO, NON DALLA STRINGA.
    // Il filtro qui sopra confronta i valori: funziona finche' il valore E' il PDF (un data URL).
    // Quando l'etichetta diventa un PERCORSO su Storage, lo stesso identico documento avra' chiavi
    // diverse — una per collo — e quel filtro non vedrebbe piu' niente: tornerebbe il guasto dei
    // 169 fogli, cioe' N copie di un PDF che di pagine ne ha gia' N.
    // Qui si confrontano i byte veri, quindi la protezione vale in entrambe le forme. Oggi non
    // cambia nulla — byte uguali vengono da stringhe uguali, gia' scartate sopra — ma quando la
    // scrittura passera' allo Storage sara' l'unica difesa rimasta, e deve esserci gia'.
    const impronte = new Set<string>()
    for (const src of sorgenti) {
      try {
        let pdfBytes: Uint8Array
        if (src.bytes) pdfBytes = src.bytes
        else if (src.url!.startsWith('data:application/pdf;base64,')) {
          const base64 = src.url!.replace('data:application/pdf;base64,', '')
          pdfBytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0))
        } else {
          const res = await fetch(src.url!)
          pdfBytes = new Uint8Array(await res.arrayBuffer())
        }
        const impronta = createHash('sha1').update(pdfBytes).digest('hex')
        if (impronte.has(impronta)) continue
        impronte.add(impronta)
        const pdf = await PDFDocument.load(pdfBytes)
        const pages = await pdfMerged.copyPages(pdf, pdf.getPageIndices())
        pages.forEach(p => pdfMerged.addPage(p))
        stampate++
      } catch(e) {
        console.error('Errore PDF:', e)
      }
    }
    // Una spedizione che esce senza NESSUNA pagina e' il guasto peggiore: il pacco parte senza
    // etichetta e nessuno se ne accorge. Nei log restava scritto, ma i log non li guarda chi
    // stampa: oggi una spedizione e' stata ristampata quattro volte di fila senza che uscisse
    // niente. Quindi il buco si mette NEL FOGLIO, dove chi stampa lo vede.
    if (!stampate) {
      console.error('[ETICHETTE-BULK] nessuna etichetta stampata per', s.numero, s.id)
      try {
        const pg = pdfMerged.addPage([283, 425])
        pg.drawText('ETICHETTA NON DISPONIBILE', { x: 20, y: 360, size: 14, font: fontBold })
        pg.drawText(String(s.numero || ''), { x: 20, y: 335, size: 12, font })
        for (const [i, riga] of [
          'Per questa spedizione non e\' stato possibile',
          'produrre l\'etichetta da stampare.',
          '',
          'Non spedire il pacco con questo foglio:',
          'apri la spedizione e ristampa la sua etichetta.',
        ].entries()) {
          pg.drawText(riga, { x: 20, y: 300 - i * 18, size: 10, font })
        }
      } catch (e) { console.error('Errore foglio segnaposto:', e) }
    }
    // ...poi il RIEPILOGO ordine SOTTO l'etichetta (se il cliente lo ha attivato).
    try { disegnaRiepilogoSped(pdfMerged, font, fontBold, riepCtx, s) } catch (e) { console.error('Errore riepilogo:', e) }
  }

  const mergedBytes = await pdfMerged.save()
  const buffer = Buffer.from(mergedBytes)

  return new NextResponse(buffer, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="etichette_${ids.length}.pdf"`,
    }
  })
}