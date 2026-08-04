import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { BUCKET_RISERVATI } from '@/lib/file-riservati'

// UN PERMESSO DI CARICAMENTO PER UN SOLO FILE.
//
// I report grossi non passano: il file viaggiava dentro la richiesta, e sopra i 4,5 MB la
// piattaforma la respinge senza spiegazioni — la pagina restava su "Generazione..." per sempre.
// Un master con qualche migliaio di spedizioni ci sbatteva ogni volta, e non c'era modo di capirlo.
//
// Qui si consegna al browser un permesso valido per UN percorso solo, dentro la cartella del suo
// master: il file va allo spazio di archiviazione per la sua strada, senza attraversare il server.
// Il permesso non e' una chiave del bucket, che resta privato: e' un lasciapassare monouso.
export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('master_id').eq('id', user.id).single()
  if (!utente?.master_id) return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })

  const { nomeFile } = await req.json().catch(() => ({}))
  // Il nome arriva da fuori: si tiene solo cio' che e' un nome di file, altrimenti con "../" si
  // scriverebbe nella cartella di un altro master.
  const pulito = String(nomeFile || 'report').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120)
  const path = `${utente.master_id}/${Date.now()}_${pulito}`

  const admin = createAdminSupabase()
  const { data, error } = await admin.storage.from(BUCKET_RISERVATI).createSignedUploadUrl(path)
  if (error || !data) {
    console.error('[REPORT] permesso di caricamento non rilasciato:', error?.message)
    return NextResponse.json({ error: error?.message || 'Caricamento non disponibile' }, { status: 400 })
  }
  return NextResponse.json({ success: true, path, signedUrl: data.signedUrl, token: data.token })
}
