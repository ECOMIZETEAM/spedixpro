import { NextRequest, NextResponse } from 'next/server'
import { bloccaCronNonAutorizzato } from '@/lib/cron-auth'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { createHash } from 'node:crypto'
import { scomponiDataUrl, caricaEtichetta, scaricaEtichetta } from '@/lib/etichette'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

// LE ETICHETTE ESCONO DAL DATABASE.
//
// Il PDF della lettera di vettura veniva salvato DENTRO la riga, come data URL base64 in
// `spedizioni.etichetta_url`. A ~150 kB per spedizione e ~1.500 spedizioni al giorno la tabella e'
// arrivata a 4.290 MB — il 94% dell'intero database, contro i 179 MB della seconda — e cresce di
// 239 MB al giorno. Di quella crescita, 1.671 MB su 7 giorni sono le etichette della spedizione e
// 215 MB quelle per collo: qui si affronta la prima parte, che e' l'89%.
//
// PERCHE' UN GIRO IN SOTTOFONDO E NON LA CREAZIONE.
// I punti che scrivono un'etichetta sono nove, di cui quattro nello stesso file — uno per corriere
// — piu' l'API pubblica, l'import e i negozi online. Metterci il caricamento dentro vorrebbe dire
// ripetere la stessa cosa in nove posti sperando di non dimenticarne uno: e' il difetto che questo
// progetto ha gia' pagato piu' volte. Qui invece si prendono le righe DOPO che sono state scritte,
// e cosi' sono coperte tutte le porte insieme, comprese quelle che nasceranno.
// In piu' la creazione non viene toccata: se questo giro si rompe, nessuno smette di spedire.
//
// PRIMO PASSO, DI PROPOSITO INCOMPLETO: qui si SCRIVE il percorso ma NON si cancella il base64.
// Serve a vedere sui dati veri che i file arrivano e si rileggono, prima di togliere l'unica altra
// copia. Lo spazio si libera al passo successivo, che e' una UPDATE su righe gia' verificate.
//
// Chi legge non deve accorgersi di niente: `leggiEtichetta` prova prima il file e poi il base64, ed
// e' gia' usata da tutte e quattro le strade di stampa.

const QUANTE = 100          // per giro: ~15 MB di traffico, ben dentro i 120 secondi
const IMPRONTA = (b: Buffer | Uint8Array) => createHash('sha1').update(b).digest('hex')

export async function GET(req: NextRequest) {
  const _b = bloccaCronNonAutorizzato(req); if (_b) return _b
  const admin = createAdminSupabase()

  // Le piu' VECCHIE per prime: sono quelle che nessuno sta stampando in questo momento, quindi la
  // finestra in cui una riga ha il percorso ma il file non fosse ancora leggibile non tocca nessuno.
  const { data: righe, error } = await admin
    .from('spedizioni')
    .select('id,numero,etichetta_url,created_at')
    .is('etichetta_path', null)
    .like('etichetta_url', 'data:%')
    .order('created_at', { ascending: true })
    .limit(QUANTE)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  let archiviate = 0, saltate = 0, fallite = 0
  const motivi: Record<string, number> = {}
  const conta = (m: string) => { motivi[m] = (motivi[m] || 0) + 1 }

  for (const r of righe || []) {
    const dato = scomponiDataUrl(r.etichetta_url)
    if (!dato || !dato.buffer.length) { saltate++; conta('non e\' un data url leggibile'); continue }

    const quando = r.created_at ? new Date(r.created_at) : new Date()
    const path = await caricaEtichetta(admin, r.id, dato.buffer, dato.mime, quando)
    if (!path) { fallite++; conta('caricamento fallito'); continue }

    // SI RILEGGE PRIMA DI FIDARSI. Un caricamento che non da' errore non garantisce che il file sia
    // integro: un buffer troncato, un'interruzione a meta', un mime sbagliato passerebbero lo
    // stesso. Qui si riscarica e si confrontano i byte uno per uno (l'impronta): se non
    // combaciano il percorso NON viene scritto, la riga resta com'era e il giro dopo riprova.
    const riletto = await scaricaEtichetta(admin, path)
    if (!riletto || IMPRONTA(riletto.buffer) !== IMPRONTA(dato.buffer)) {
      fallite++; conta('riletto diverso da cio\' che era stato caricato')
      console.error('[ARCHIVIA-ETICHETTE] verifica fallita', r.numero, path)
      continue
    }

    // Solo adesso la riga impara dove sta il suo file. `etichetta_url` resta dov'e': finche' non
    // avremo la prova sul campo che questo giro e' affidabile, le copie restano due.
    const { error: upErr } = await admin.from('spedizioni').update({ etichetta_path: path }).eq('id', r.id)
    if (upErr) { fallite++; conta('scrittura del percorso fallita'); console.error('[ARCHIVIA-ETICHETTE]', r.numero, upErr.message); continue }
    archiviate++
  }

  const esito = { archiviate, saltate, fallite, esaminate: (righe || []).length, motivi }
  console.log('[ARCHIVIA-ETICHETTE]', JSON.stringify(esito))
  return NextResponse.json(esito)
}
