import { NextRequest, NextResponse } from 'next/server'
import { bloccaCronNonAutorizzato } from '@/lib/cron-auth'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { archiviaLotto, liberaEtichetteArchiviate } from '@/lib/etichette'

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

// Il lavoro vero sta in lib/etichette.ts: lo chiama anche tmp-recupero, che e' un cron gia' vivo.
// Questa rotta resta come innesco dedicato e per poterla lanciare a mano quando serve.
//
// Da quando questo innesco gira davvero (ogni 10 minuti) fa anche la seconda meta': toglie dalla
// riga il base64 gia' archiviato (liberaEtichetteArchiviate). A inizio novembre 2026 erano ~450.000
// le spedizioni archiviate col PDF ancora dentro, e il giro di tmp-recupero da solo ne chiude al
// massimo 150 ogni quarto d'ora. Il grosso si fa di NOTTE, quando il database e' quasi fermo; di
// giorno un lotto piccolo, per non pesare su chi sta spedendo.
export async function GET(req: NextRequest) {
  const _b = bloccaCronNonAutorizzato(req); if (_b) return _b
  const inizio = Date.now()
  const admin = createAdminSupabase()
  const archiviate = await archiviaLotto(admin, 100)
  const ora = Number(new Intl.DateTimeFormat('it-IT', { timeZone: 'Europe/Rome', hour: 'numeric', hourCycle: 'h23' }).format(new Date()))
  const notte = ora >= 21 || ora < 7
  // Dentro i 120 secondi della funzione, con margine: quello che resta dopo l'archiviazione.
  const resta = 100_000 - (Date.now() - inizio)
  const liberate = resta > 10_000
    ? await liberaEtichetteArchiviate(admin, notte ? 1000 : 200, { entroMs: Math.min(notte ? 80_000 : 25_000, resta), inParallelo: notte ? 4 : 2 })
    : null
  return NextResponse.json({ ...archiviate, liberate })
}
