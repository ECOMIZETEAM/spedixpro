import { BUCKET_RISERVATI } from '@/lib/file-riservati'

// Carica gli allegati (foto/PDF/qualsiasi file) sullo storage privato e ritorna i riferimenti da
// salvare ({url,nome,tipo}). Il bucket è privato: il file si scarica solo da /api/file, che
// verifica chi lo chiede. Si conserva il TIPO REALE del file (image/…, application/pdf, …), così
// una foto non viene mai salvata come PDF illeggibile. Il percorso è `allegati/<folderId>/…`:
// chi serve i file usa quel prefisso per delimitare cosa può uscire (ticket, notifiche, …).
// Usata dai ticket (apertura + chat) e dalle notifiche broadcast del master.
export async function caricaAllegati(admin: any, folderId: string, allegatiIn: any[]): Promise<Array<{ url: string; nome: string; tipo: string }>> {
  const out: Array<{ url: string; nome: string; tipo: string }> = []
  const arr = Array.isArray(allegatiIn) ? allegatiIn.slice(0, 10) : []
  for (let i = 0; i < arr.length; i++) {
    const a = arr[i]
    try {
      const dati = String(a?.dati || '')
      const b64 = dati.split(',').pop() || dati
      if (!b64) continue
      const buffer = Buffer.from(b64, 'base64')
      if (!buffer.length) continue
      const nomePulito = String(a?.nome || 'file').replace(/[^a-zA-Z0-9._-]/g, '_').slice(-60)
      const ct = String(a?.tipo || 'application/octet-stream')
      const path = `allegati/${folderId || 'x'}/${Date.now()}_${i}_${nomePulito}`
      const { error } = await admin.storage.from(BUCKET_RISERVATI).upload(path, buffer, { contentType: ct, upsert: true })
      if (!error) out.push({ url: path, nome: String(a?.nome || 'file'), tipo: ct })
    } catch { /* salta l'allegato non valido */ }
  }
  return out
}

// Alias storico: i ticket continuano a chiamare questo nome.
export const caricaAllegatiTicket = caricaAllegati
