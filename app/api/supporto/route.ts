import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { BUCKET_RISERVATI } from '@/lib/file-riservati'
import { Resend } from 'resend'

/* SUPPORTO DELLA PIATTAFORMA — dal portale a info@moovexpress.com.
 *
 * Diverso dai TICKET (cliente → suo master): qui è l'utente del portale che scrive a NOI.
 * L'utente compila oggetto/categoria/descrizione ed eventuali allegati (già caricati su storage dal
 * widget), noi mandiamo un'email a info@moovexpress.com con replyTo al suo indirizzo — così basta
 * "Rispondi" per rispondergli. Gli allegati viaggiano come LINK firmati (30 giorni), non come file
 * dentro l'email: regge anche un video. */

const A = process.env.CONTATTI_A || 'info@moovexpress.com'
export const CATEGORIE = [
  'Problema tecnico', 'Domanda sull’uso', 'Fatturazione e credito',
  'Spedizioni e corrieri', 'Richiesta funzionalità', 'Altro',
]

const esc = (s: string) => String(s || '').replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' } as Record<string, string>)[c])

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
  const { data: utente } = await supabase.from('utenti').select('nome, ruolo').eq('id', user.id).maybeSingle()

  const body = await req.json().catch(() => ({} as any))
  const oggetto = String(body?.oggetto || '').trim().slice(0, 200)
  const categoria = String(body?.categoria || '').trim().slice(0, 60)
  const descrizione = String(body?.descrizione || '').trim().slice(0, 5000)
  const allegati: any[] = Array.isArray(body?.allegati) ? body.allegati.slice(0, 3) : []

  if (!oggetto || !categoria || !descrizione) {
    return NextResponse.json({ error: 'Compila oggetto, categoria e descrizione.' }, { status: 400 })
  }
  if (!CATEGORIE.includes(categoria)) {
    return NextResponse.json({ error: 'Categoria non valida.' }, { status: 400 })
  }

  const chiave = process.env.RESEND_API_KEY
  if (!chiave) {
    console.error('[SUPPORTO] RESEND_API_KEY assente')
    return NextResponse.json({ error: 'Invio non disponibile al momento.' }, { status: 503 })
  }

  // Link firmati (30 giorni) agli allegati già caricati dal widget: chi legge info@ li apre senza
  // login. Accetto SOLO percorsi nella cartella supporto/ (quelli appena caricati), mai altri.
  const admin = createAdminSupabase()
  const links: { nome: string; url: string }[] = []
  for (const a of allegati) {
    const path = String(a?.path || '')
    if (!path.startsWith('supporto/')) continue
    const { data } = await admin.storage.from(BUCKET_RISERVATI).createSignedUrl(path, 60 * 60 * 24 * 30)
    if (data?.signedUrl) links.push({ nome: String(a?.nome || 'allegato').slice(0, 120), url: data.signedUrl })
  }

  const righe = [
    ['Da', `${esc(utente?.nome || '—')} (${esc(user.email || '—')})`],
    ['Ruolo', esc(utente?.ruolo || '—')],
    ['Categoria', esc(categoria)],
    ['Oggetto', esc(oggetto)],
  ].map(([k, v]) => `<tr><td style="padding:4px 14px 4px 0;color:#888;vertical-align:top">${k}</td><td style="padding:4px 0;color:#111">${v}</td></tr>`).join('')

  const allegatiHtml = links.length
    ? `<p style="margin:18px 0 6px;color:#888">Allegati</p><ul style="margin:0;padding-left:18px">${links.map(l => `<li><a href="${l.url}" style="color:#f97316">${esc(l.nome)}</a></li>`).join('')}</ul><p style="color:#aaa;font-size:12px;margin-top:6px">I link scadono tra 30 giorni.</p>`
    : ''

  const html = `<div style="font-family:system-ui,-apple-system,sans-serif;font-size:14px;color:#111;line-height:1.5">
    <h2 style="margin:0 0 14px;font-size:18px">Richiesta di supporto</h2>
    <table style="border-collapse:collapse;margin-bottom:16px">${righe}</table>
    <div style="white-space:pre-wrap;border-left:3px solid #f97316;padding:2px 0 2px 14px;color:#333">${esc(descrizione)}</div>
    ${allegatiHtml}
  </div>`

  const resend = new Resend(chiave)
  const daRaw = process.env.EMAIL_FROM || 'MoovExpress <noreply@moovexpress.com>'
  const r: any = await resend.emails.send({
    from: daRaw.includes('<') ? daRaw : `MoovExpress <${daRaw}>`,
    to: A,
    replyTo: user.email || undefined,
    subject: `Supporto — ${categoria}: ${oggetto}`.slice(0, 180),
    html,
  })
  if (r?.error) {
    console.error('[SUPPORTO] invio fallito:', r.error?.message || r.error)
    return NextResponse.json({ error: 'Invio non riuscito. Riprova tra poco.' }, { status: 502 })
  }
  return NextResponse.json({ ok: true })
}
