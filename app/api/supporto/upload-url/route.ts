import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { BUCKET_RISERVATI } from '@/lib/file-riservati'

// Permesso di caricamento monouso per UN allegato del Supporto. Il file va diritto allo spazio di
// archiviazione (bucket privato), senza passare dal server: così regge anche uno screen-video, che
// come corpo di una richiesta sforerebbe il limite di ~4,5 MB della piattaforma.
export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('master_id').eq('id', user.id).maybeSingle()
  const cartella = utente?.master_id || user.id

  const { nomeFile } = await req.json().catch(() => ({}))
  // Il nome arriva da fuori: si tiene solo ciò che è un nome di file (niente "../").
  const pulito = String(nomeFile || 'allegato').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120)
  const path = `supporto/${cartella}/${Date.now()}_${pulito}`

  const admin = createAdminSupabase()
  const { data, error } = await admin.storage.from(BUCKET_RISERVATI).createSignedUploadUrl(path)
  if (error || !data) {
    console.error('[SUPPORTO] permesso di caricamento non rilasciato:', error?.message)
    return NextResponse.json({ error: 'Caricamento non disponibile' }, { status: 400 })
  }
  return NextResponse.json({ bucket: BUCKET_RISERVATI, path, token: data.token, signedUrl: data.signedUrl })
}
