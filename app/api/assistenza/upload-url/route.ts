import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { BUCKET_RISERVATI } from '@/lib/file-riservati'

// Permesso di caricamento monouso per UN allegato della chat ticket. Il file (es. un video) va
// DIRITTO allo storage privato, senza passare dal corpo della richiesta (che sforerebbe il limite
// di ~4,5 MB della piattaforma). Cartella PER-UTENTE (allegati/<user.id>/): l'invio del messaggio
// accetta come "già caricato" solo i path dentro questa cartella, così nessuno può riferire il file
// di un altro (anti-IDOR). Il file resta comunque leggibile solo da /api/file, e solo se referenziato
// da un ticket a cui si partecipa. Chi ha un video piccolo puo' sempre usare la via base64.
export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })

  const { nomeFile } = await req.json().catch(() => ({}))
  const pulito = String(nomeFile || 'allegato').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120)
  const path = `allegati/${user.id}/${Date.now()}_${pulito}`

  const admin = createAdminSupabase()
  const { data, error } = await admin.storage.from(BUCKET_RISERVATI).createSignedUploadUrl(path)
  if (error || !data) {
    console.error('[ASSISTENZA] permesso di caricamento non rilasciato:', error?.message)
    return NextResponse.json({ error: 'Caricamento non disponibile' }, { status: 400 })
  }
  return NextResponse.json({ bucket: BUCKET_RISERVATI, path, token: data.token, signedUrl: data.signedUrl })
}
