import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { chiavePubblicaWeb } from '@/lib/notifiche-push'

// I DISPOSITIVI CHE RICEVONO LE NOTIFICHE di chi ha la sessione (calendario, fase 3): il browser (Web Push) o l'app
// (iPhone: token APNs; Android: token Firebase). Tabella notifiche_dispositivi, solo col client di servizio.
// UN DISPOSITIVO È DI CHI HA PREMUTO «ATTIVA» PER ULTIMO (esplicito): su un computer condiviso, se l'altra persona le
// attiva, passa a lei e le notifiche della prima smettono di arrivare lì. L'aggancio automatico all'apertura del
// portale (esplicito falso) rinnova SOLO un dispositivo che è già di chi ha la sessione — anche col token cambiato dal
// telefono (precedente) — e non lo passa mai a un altro: chi non le ha chieste non le riceve. All'uscita («Esci») il
// portale lo stacca prima di chiudere la sessione (app/components/calendario/dispositivo.ts).
// USCIRE NON È SPEGNERE: chi esce e rientra sullo stesso dispositivo le ritrova (l'aggancio automatico riprende una riga
// staccata all'uscita); chi le ha SPENTE («Disattiva») o un dispositivo che il servizio dà per morto no. Senza questa
// distinzione, sull'iPhone «Disattiva» durava fino alla riapertura dell'app: il telefono ridà spesso lo stesso token e
// l'aggancio le riaccendeva da solo.
const TIPI = new Set(['web', 'ios', 'android'])
const USCITO = 'uscito dal portale'

async function chi() {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  return user
}

export async function GET(req: NextRequest) {
  const user = await chi()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data, error } = await createAdminSupabase().from('notifiche_dispositivi')
    .select('id,tipo,etichetta,creato_il,ultimo_uso,indirizzo').eq('utente_id', user.id).is('disattivato_il', null).order('creato_il', { ascending: false }).limit(20)
  if (error) return NextResponse.json({ error: 'Lettura non riuscita: ' + error.message }, { status: 500 })
  // «questo dispositivo è mio e attivo?»: lo chiede la pagina col suo indirizzo (che non si rimanda mai indietro)
  const qui = req.nextUrl.searchParams.get('indirizzo')
  return NextResponse.json({
    vapid: chiavePubblicaWeb(),
    questo: !!qui && (data || []).some((d: any) => d.indirizzo === qui),
    dispositivi: (data || []).map(({ indirizzo, ...d }: any) => d),
  })
}

export async function POST(req: NextRequest) {
  const user = await chi()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const b = await req.json().catch(() => null)
  const tipo = String(b?.tipo || ''), indirizzo = String(b?.indirizzo || '').trim()
  if (!TIPI.has(tipo) || indirizzo.length < 20 || indirizzo.length > 1000) return NextResponse.json({ error: 'Dispositivo non valido' }, { status: 400 })
  // il browser deve mandare un indirizzo dei servizi push veri (https) e le sue due chiavi
  if (tipo === 'web' && (!/^https:\/\//.test(indirizzo) || !b?.p256dh || !b?.auth)) return NextResponse.json({ error: 'Iscrizione del browser incompleta' }, { status: 400 })
  if (tipo !== 'web' && !/^[A-Za-z0-9:_\-.]+$/.test(indirizzo)) return NextResponse.json({ error: 'Token non valido' }, { status: 400 })
  const riga = {
    utente_id: user.id, tipo, indirizzo,
    p256dh: tipo === 'web' ? String(b.p256dh).slice(0, 200) : null,
    auth: tipo === 'web' ? String(b.auth).slice(0, 100) : null,
    etichetta: b?.etichetta ? String(b.etichetta).slice(0, 80) : null,
    disattivato_il: null, motivo_spento: null, ultimo_uso: new Date().toISOString(),
  }
  const admin = createAdminSupabase()
  if (b?.esplicito !== true) {
    // aggancio automatico: si rinnova solo una riga già mia (con l'indirizzo di oggi o con quello di prima)
    const precedente = b?.precedente ? String(b.precedente).slice(0, 1000) : null
    const { data: mia } = await admin.from('notifiche_dispositivi').select('id,utente_id').in('indirizzo', [indirizzo, precedente].filter(Boolean) as string[])
      .eq('utente_id', user.id).or(`disattivato_il.is.null,motivo_spento.eq."${USCITO}"`).order('creato_il', { ascending: false }).limit(1).maybeSingle()
    if (!mia) return NextResponse.json({ ok: false, motivo: 'non attivato da te su questo dispositivo' })
    const { error } = await admin.from('notifiche_dispositivi').update(riga).eq('id', mia.id)
    if (error) return NextResponse.json({ error: 'Dispositivo non salvato: ' + error.message }, { status: 500 })
    return NextResponse.json({ ok: true, id: mia.id })
  }
  const { data, error } = await admin.from('notifiche_dispositivi').upsert(riga, { onConflict: 'indirizzo' }).select('id').single()
  if (error) return NextResponse.json({ error: 'Dispositivo non salvato: ' + error.message }, { status: 500 })
  return NextResponse.json({ ok: true, id: data.id })
}

// stacca un dispositivo: per id (dall'elenco) o per indirizzo (questo dispositivo: «Disattiva», o all'uscita con
// uscita: true). Solo i propri.
export async function DELETE(req: NextRequest) {
  const user = await chi()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const b = await req.json().catch(() => null)
  const id = String(b?.id || ''), indirizzo = String(b?.indirizzo || '')
  if (!id && !indirizzo) return NextResponse.json({ error: 'Quale dispositivo?' }, { status: 400 })
  let q = createAdminSupabase().from('notifiche_dispositivi').update({ disattivato_il: new Date().toISOString(), motivo_spento: b?.uscita === true ? USCITO : 'spento da chi lo usava' })
    .eq('utente_id', user.id).is('disattivato_il', null)
  q = id ? q.eq('id', id) : q.eq('indirizzo', indirizzo)
  const { error } = await q
  if (error) return NextResponse.json({ error: 'Non riuscito: ' + error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
