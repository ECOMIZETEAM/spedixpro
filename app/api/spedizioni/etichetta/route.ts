import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { isAgente, clientiAgente } from '@/lib/agente'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { preparaRiepiloghi, disegnaRiepilogoSped } from '@/lib/riepilogo-ordine'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })

  const { data: utente } = await supabase
    .from('utenti').select('ruolo, cliente_id, master_id, nome, cognome').eq('id', user.id).single()

  const url = new URL(req.url)
  const id = url.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'ID spedizione mancante' }, { status: 400 })

  const { data: sped } = await supabase
    .from('spedizioni')
    .select('etichetta_url, etichetta_path, colli_dettaglio, cliente_id, master_id, numero, raw_response, corriere_id')
    .eq('id', id)
    .single()
  if (!sped) return NextResponse.json({ error: 'Spedizione non trovata' }, { status: 404 })

  // Isolamento multi-tenant
  if (utente?.ruolo === 'cliente') {
    if (sped.cliente_id !== utente.cliente_id) {
      return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
    }
  } else if (utente?.master_id && sped.master_id !== utente.master_id) {
    // Il master vede le etichette di TUTTA la sua rete (sotto-albero), non solo le proprie:
    // le spedizioni dei sotto-master hanno master_id = sotto-master. (Era il bug "non autorizzato".)
    const { createAdminSupabase } = await import('@/lib/supabase-admin')
    const { sottoAlberoMasterIds } = await import('@/lib/rete-masters')
    const rete = await sottoAlberoMasterIds(createAdminSupabase(), utente.master_id)
    if (!sped.master_id || !rete.includes(sped.master_id)) {
      return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
    }
  }
  // Agente: solo etichette di un suo cliente.
  if (isAgente(utente as any)) {
    const miei = await clientiAgente(supabase, utente as any)
    if (!sped.cliente_id || !miei.includes(sped.cliente_id)) return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  }

  // Riepilogo ordine (se il cliente lo ha attivato): viene ANTEPOSTO all'etichetta quando è un PDF.
  const { createAdminSupabase: _admR } = await import('@/lib/supabase-admin')
  const _adminR = _admR()
  const { data: spedFull } = await _adminR.from('spedizioni')
    .select('id,numero,created_at,rif_ordine,contenuto,colli,peso_reale,peso_fatturato,contrassegno,dest_nome,dest_indirizzo,dest_citta,dest_cap,dest_provincia,dest_paese,dest_telefono,mitt_nome,cliente_id,corrieri(nome_contratto)')
    .eq('id', id).maybeSingle()
  const riepCtx = spedFull ? await preparaRiepiloghi(_adminR, [spedFull]) : null
  const conRiepilogo = async (buf: Buffer): Promise<Buffer> => {
    if (!riepCtx || !spedFull || !riepCtx.riepilogoCli.get((spedFull as any).cliente_id)) return buf
    try {
      const out = await PDFDocument.create()
      const font = await out.embedFont(StandardFonts.Helvetica)
      const fontBold = await out.embedFont(StandardFonts.HelveticaBold)
      // Prima l'ETICHETTA, poi il riepilogo SOTTO.
      const label = await PDFDocument.load(new Uint8Array(buf))
      const pages = await out.copyPages(label, label.getPageIndices())
      pages.forEach(p => out.addPage(p))
      disegnaRiepilogoSped(out, font, fontBold, riepCtx, spedFull)
      return Buffer.from(await out.save())
    } catch (e) { console.error('Riepilogo singola etichetta:', e); return buf }
  }

  // MULTICOLLO PRIMA DI TUTTO. Se ogni collo ha la SUA etichetta, si UNISCONO — e va fatto PRIMA
  // delle sorgenti a etichetta SINGOLA (Storage `etichetta_path`, labelData, `etichetta_url`), che
  // portano UNA sola etichetta combinata a 1 pagina. Prima l'unione stava DOPO `etichetta_path`:
  // su una spedizione con l'etichetta anche su Storage, la route serviva quella (1 pagina) e usciva
  // senza mai unire i colli -> ne usciva UNA sola. Successo su 3UW1WLJ011344 (2 colli, 2 numeri).
  // I doppioni si riconoscono dai BYTE: alcuni contratti mandano UN pdf gia' a N pagine copiato su
  // ogni collo — impilarlo darebbe NxN fogli, quindi qui resta una copia sola (e si va al singolo).
  {
    let unito: Buffer | null = null
    if (Array.isArray(sped.colli_dettaglio) && sped.colli_dettaglio.length > 1) {
      const { scomponiDataUrl } = await import('@/lib/etichette')
      const { createHash } = await import('node:crypto')
      const viste = new Set<string>()
      const pezzi: Buffer[] = []
      for (const c of (sped.colli_dettaglio as any[])) {
        const d = scomponiDataUrl(c?.etichetta_url)
        if (!d?.buffer?.length) continue
        const impronta = createHash('sha1').update(d.buffer).digest('hex')
        if (viste.has(impronta)) continue
        viste.add(impronta); pezzi.push(d.buffer)
      }
      if (pezzi.length > 1) {
        try {
          const out = await PDFDocument.create()
          for (const b of pezzi) {
            const pdf = await PDFDocument.load(new Uint8Array(b))
            const pagine = await out.copyPages(pdf, pdf.getPageIndices())
            pagine.forEach(pg => out.addPage(pg))
          }
          unito = Buffer.from(await out.save())
        } catch (e) {
          console.error('[ETICHETTA] unione colli fallita', sped.numero, e)
        }
      }
    }
    if (unito) {
      const outBuf = await conRiepilogo(unito)
      return new NextResponse(new Uint8Array(outBuf), { status: 200, headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="etichette-${sped.numero || id}.pdf"`,
        'Cache-Control': 'private, max-age=0, no-store',
      } })
    }
  }

  // FORMA NUOVA: il PDF sta su Storage e nella riga c'e' solo il percorso. Si prova per prima;
  // se il file non c'e' si prosegue con le forme storiche qui sotto, senza interrompere nulla.
  if ((sped as any).etichetta_path) {
    const { leggiEtichetta } = await import('@/lib/etichette')
    const { createAdminSupabase: _admE } = await import('@/lib/supabase-admin')
    const et = await leggiEtichetta(_admE(), sped as any)
    if (et) {
      const out = et.mime === 'application/pdf' ? await conRiepilogo(et.buffer) : et.buffer
      return new NextResponse(new Uint8Array(out), { status: 200, headers: {
        'Content-Type': et.mime,
        'Content-Disposition': `attachment; filename="etichetta-${sped.numero || id}.${et.ext}"`,
        'Cache-Control': 'private, max-age=0, no-store',
      } })
    }
  }

  // Caso spedisci.online: etichetta come labelData base64 dentro raw_response.
  // ORDINE INVERTITO: prima etichetta_url, questa resta solo come RETE DI SICUREZZA per le
  // spedizioni vecchie. Il PDF era salvato TRE volte (etichetta_url, dentro ogni collo di
  // colli_dettaglio e qui): verificato su 300 spedizioni che le tre copie sono identiche al byte.
  // Leggendo prima etichetta_url si puo' liberare questa copia senza che nessuno se ne accorga.
  const labelData = (sped.raw_response as any)?.labelData
  if (labelData && !sped.etichetta_url) {
    const buf = await conRiepilogo(Buffer.from(labelData, 'base64'))
    return new NextResponse(new Uint8Array(buf), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="etichetta-${sped.numero || id}.pdf"`,
        'Cache-Control': 'private, max-age=0, no-store',
      },
    })
  }

  // (L'unione multicollo è gestita in CIMA, prima delle sorgenti a etichetta singola — vedi sopra.)

  // Un collo solo (o etichette tutte identiche): prima quella della spedizione, poi quella del collo.
  let src: string | null = sped.etichetta_url || null
  if (!src && Array.isArray(sped.colli_dettaglio)) {
    src = (sped.colli_dettaglio as any[]).find(c => c?.etichetta_url)?.etichetta_url || null
  }

  // Stesso ripiego per i contratti DVA: li' l'etichetta nasce da una chiamata separata (la lettera
  // di vettura) che alla creazione puo' non essere ancora pronta. Senza questo, l'unica speranza
  // sarebbe il giro automatico e nel frattempo il tasto "Etichetta" direbbe "non disponibile".
  if (!src && (sped as any).corriere_id) {
    const idOrdine = (sped.raw_response as any)?._idOrdine
    if (idOrdine) {
      const { data: corrEP } = await createAdminSupabase().from('corrieri').select('tipo,credenziali').eq('id', (sped as any).corriere_id).maybeSingle()
      const apikeyEP = (corrEP?.credenziali as any)?.apikey
      if (corrEP?.tipo === 'easyparcel' && apikeyEP) {
        try {
          const { easyparcelWaybill } = await import('@/lib/easyparcel')
          const w = await easyparcelWaybill(apikeyEP, String(idOrdine), 2, 1500)
          // Multicollo: le etichette dei singoli colli vanno unite in un PDF unico multipagina,
          // altrimenti si scaricherebbe solo quella del primo collo.
          const { unisciEtichette } = await import('@/lib/easyparcel')
          const b64 = (await unisciEtichette(w.singole.map(s => s.pdfBase64))) || w.pdfBase64
          if (b64) {
            const buf = Buffer.from(b64, 'base64')
            const dataUrl = `data:application/pdf;base64,${b64}`
            try { const { createAdminSupabase } = await import('@/lib/supabase-admin'); await createAdminSupabase().from('spedizioni').update({ etichetta_url: dataUrl, ...(w.numero ? { tracking_number: w.numero } : {}) }).eq('id', id) } catch {}
            const outBuf = await conRiepilogo(buf)
            return new NextResponse(new Uint8Array(outBuf), { status: 200, headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="etichetta-${sped.numero || id}.pdf"`, 'Cache-Control': 'private, max-age=0, no-store' } })
          }
        } catch {
          return NextResponse.json({ error: 'Etichetta non ancora pronta dal corriere (spedizione in lavorazione). Riprova tra qualche minuto.' }, { status: 409 })
        }
      }
    }
  }

  // Fallback SpediamoPro: se l'etichetta non è stata salvata alla creazione (es. non pronta subito
  // per il multicollo), la scarichiamo ORA dall'API col shipment id, e la salviamo per le prossime.
  if (!src) {
    const shipId = (sped.raw_response as any)?.id || (sped.raw_response as any)?.shipmentId
    if (shipId && (sped as any).corriere_id) {
      const { data: corr } = await createAdminSupabase().from('corrieri').select('tipo,credenziali').eq('id', (sped as any).corriere_id).maybeSingle()
      const authcode = (corr?.credenziali as any)?.authcode
      if (corr?.tipo === 'spediamopro' && authcode) {
        try {
          const { spediamoproGetLabel, normalizzaEtichetta } = await import('@/lib/spediamopro')
          const raw = await spediamoproGetLabel(authcode, Number(shipId))
          // ZIP multicollo → PDF unico; PDF/GIF/PNG mono-collo invariati.
          const { buffer: buf, mime, ext } = await normalizzaEtichetta(raw)
          try { const { createAdminSupabase } = await import('@/lib/supabase-admin'); await createAdminSupabase().from('spedizioni').update({ etichetta_url: `data:${mime};base64,${buf.toString('base64')}` }).eq('id', id) } catch {}
          const outBuf = mime === 'application/pdf' ? await conRiepilogo(buf) : buf
          return new NextResponse(new Uint8Array(outBuf), { status: 200, headers: { 'Content-Type': mime, 'Content-Disposition': `attachment; filename="etichetta-${sped.numero || id}.${ext}"`, 'Cache-Control': 'private, max-age=0, no-store' } })
        } catch (e: any) {
          // Etichetta non ancora generata dal corriere (tipico del multicollo appena creato).
          const m = String(e?.message || '')
          if (/etichetta associata|non ha un'etichetta|422/i.test(m)) {
            return NextResponse.json({ error: 'Etichetta non ancora pronta dal corriere (spedizione in lavorazione). Riprova tra qualche minuto.' }, { status: 409 })
          }
        }
      }
    }
  }

  if (!src) return NextResponse.json({ error: 'Etichetta non disponibile' }, { status: 404 })

  // Caso 1: data URL base64 (PDF singolo/unito, immagini UPS, o ZIP di fallback)
  const m = src.match(/^data:(application\/pdf|application\/zip|image\/[\w.+-]+);base64,(.+)$/s)
  if (m) {
    const ext = m[1] === 'application/zip' ? 'zip' : m[1].startsWith('image/') ? m[1].split('/')[1] : 'pdf'
    // Riepilogo solo se PDF (zip/immagini non mergiabili).
    const buf = m[1] === 'application/pdf' ? await conRiepilogo(Buffer.from(m[2], 'base64')) : Buffer.from(m[2], 'base64')
    return new NextResponse(new Uint8Array(buf), {
      status: 200,
      headers: {
        'Content-Type': m[1],
        'Content-Disposition': `attachment; filename="etichetta-${sped.numero || id}.${ext}"`,
        'Cache-Control': 'private, max-age=0, no-store',
      },
    })
  }
  const filename = `etichetta-${sped.numero || id}.pdf`

  // Caso 2: URL remoto → proxy
  if (/^https?:\/\//i.test(src)) {
    try {
      const r = await fetch(src)
      if (!r.ok) return NextResponse.json({ error: 'Etichetta non raggiungibile' }, { status: 502 })
      const ct = r.headers.get('content-type') || 'application/pdf'
      let buf = Buffer.from(await r.arrayBuffer())
      if (/pdf/i.test(ct)) buf = await conRiepilogo(buf)
      return new NextResponse(new Uint8Array(buf), {
        status: 200,
        headers: {
          'Content-Type': ct,
          'Content-Disposition': `attachment; filename="${filename}"`,
          'Cache-Control': 'private, max-age=0, no-store',
        },
      })
    } catch {
      return NextResponse.json({ error: 'Errore nel recupero etichetta' }, { status: 502 })
    }
  }

  return NextResponse.json({ error: 'Formato etichetta non riconosciuto' }, { status: 400 })
}
