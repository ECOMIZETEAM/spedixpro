'use client'
import { createClient } from '@/lib/supabase-browser'
import { BUCKET_RISERVATI } from '@/lib/file-riservati'

// COME SI ARCHIVIA UN REPORT, PICCOLO O GROSSO CHE SIA.
//
// Il file viaggiava dentro la richiesta al server. Funziona finche' e' piccolo: sopra i 4,5 MB la
// piattaforma respinge la richiesta prima ancora che il nostro codice la veda, e la pagina resta
// su "Generazione..." senza un errore, senza un messaggio, senza niente. Un master con qualche
// migliaio di spedizioni ci sbatteva ogni volta: il report piu' grosso riuscito era gia' a tre
// quarti del tetto.
//
// Quindi: i file piccoli continuano per la strada di prima, che e' semplice e funziona. I grossi
// se ne vanno per conto loro allo spazio di archiviazione, con un permesso monouso valido per un
// percorso solo, e al server arriva solo il percorso. Nessun limite pratico, e il bucket resta
// privato come prima.
const SOGLIA = 3 * 1024 * 1024

function tipoContenuto(formato: string): string {
  const f = String(formato || '').toLowerCase()
  if (f === 'pdf') return 'application/pdf'
  if (f === 'csv') return 'text/csv'
  if (f === 'zip') return 'application/zip'
  return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
}

function inBlob(base64: string, contentType: string): Blob {
  const puro = base64.split(',').pop() || base64
  const bin = atob(puro)
  const buf = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i)
  return new Blob([buf], { type: contentType })
}

export type EsitoReport = { success: boolean; error?: string; report?: any }

export async function inviaReport(opts: {
  tipo: string; filtri: string; formato: string; fileBase64: string; nomeFile: string; clienteId?: string | null
}): Promise<EsitoReport> {
  const { tipo, filtri, formato, fileBase64, nomeFile, clienteId } = opts
  const puro = fileBase64.split(',').pop() || fileBase64
  // Il base64 e' un terzo piu' lungo del file vero: la misura si stima da li' senza costruire nulla.
  const peso = Math.floor((puro.length * 3) / 4)

  const registra = (extra: any) => fetch('/api/reports/salva', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tipo, filtri, formato, nomeFile, clienteId: clienteId || null, ...extra }),
  }).then(r => r.json()).catch(e => ({ success: false, error: String(e?.message || e) }))

  if (peso <= SOGLIA) return registra({ fileBase64 })

  try {
    const permesso = await fetch('/api/reports/upload-url', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nomeFile }),
    }).then(r => r.json())
    if (!permesso?.success || !permesso?.token) {
      return { success: false, error: permesso?.error || 'Caricamento non disponibile' }
    }
    const contentType = tipoContenuto(formato)
    const blob = inBlob(puro, contentType)
    const sb = createClient()
    const { error } = await sb.storage.from(BUCKET_RISERVATI)
      .uploadToSignedUrl(permesso.path, permesso.token, blob, { contentType })
    if (error) return { success: false, error: error.message }
    return registra({ pathCaricato: permesso.path, dimensione: blob.size })
  } catch (e: any) {
    return { success: false, error: String(e?.message || e) }
  }
}
