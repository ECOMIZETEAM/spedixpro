import { Resend } from 'resend'

const resend = new Resend(process.env.RESEND_API_KEY)
const FROM = process.env.EMAIL_FROM || 'MoovExpress <onboarding@resend.dev>'

// Intestazione/footer comuni MoovExpress
function wrap(inner: string): string {
  return `
  <div style="font-family:sans-serif;max-width:520px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e8e8e8">
    <div style="background:#1a1a1a;padding:24px 32px">
      <div style="font-size:20px;font-weight:800;color:#fff">Moov<span style="color:#f97316">Express</span></div>
    </div>
    <div style="padding:32px">${inner}</div>
  </div>`
}

// Email di prova (verifica dominio/mittente Resend). Ritorna esito + id Resend o errore.
export async function inviaEmailTest(to: string): Promise<{ ok: boolean; from: string; id?: string | null; error?: string }> {
  try {
    const r: any = await resend.emails.send({
      from: FROM,
      to,
      subject: 'Test email — MoovExpress ✅',
      html: wrap(`
        <h2 style="font-size:20px;color:#1a1a1a;margin:0 0 12px">✅ Email di prova riuscita</h2>
        <p style="color:#666;font-size:14px;line-height:1.6;margin:0 0 12px">Se stai leggendo questa email, l'invio dal dominio <strong>moovexpress.com</strong> tramite Resend funziona correttamente.</p>
        <p style="color:#999;font-size:12px;margin-top:16px">Mittente: ${FROM}</p>
      `),
    })
    if (r?.error) return { ok: false, from: FROM, error: r.error?.message || JSON.stringify(r.error) }
    return { ok: true, from: FROM, id: r?.data?.id || null }
  } catch (err: any) {
    return { ok: false, from: FROM, error: String(err?.message || err) }
  }
}

// Email credenziali (clienti e master): email + password + link portale
export async function inviaCredenzialiCliente({
  email, nomeCliente, masterNome, dominio, password
}: {
  email: string; nomeCliente: string; masterNome: string; dominio: string; password: string
}) {
  const portale = dominio || 'moovexpress.com'
  try {
    await resend.emails.send({
      from: FROM,
      to: email,
      subject: `Benvenuto su ${masterNome} — Le tue credenziali di accesso`,
      html: wrap(`
        <h2 style="font-size:20px;color:#1a1a1a;margin:0 0 12px">Benvenuto, ${nomeCliente}!</h2>
        <p style="color:#666;font-size:14px;line-height:1.6;margin:0 0 20px">${masterNome} ti ha creato un account sulla piattaforma di gestione spedizioni.</p>
        <div style="background:#f5f5f5;border-radius:8px;padding:20px 24px;margin-bottom:20px">
          <div style="padding:8px 0;border-bottom:1px solid #e8e8e8;font-size:13px;display:flex;justify-content:space-between">
            <span style="color:#999;text-transform:uppercase;font-size:11px;letter-spacing:0.5px">Portale</span>
            <strong style="color:#1a1a1a;font-family:monospace">${portale}</strong>
          </div>
          <div style="padding:8px 0;border-bottom:1px solid #e8e8e8;font-size:13px;display:flex;justify-content:space-between">
            <span style="color:#999;text-transform:uppercase;font-size:11px;letter-spacing:0.5px">Email</span>
            <strong style="color:#1a1a1a;font-family:monospace">${email}</strong>
          </div>
          <div style="padding:8px 0;font-size:13px;display:flex;justify-content:space-between">
            <span style="color:#999;text-transform:uppercase;font-size:11px;letter-spacing:0.5px">Password</span>
            <strong style="color:#f97316;font-family:monospace;font-size:16px">${password}</strong>
          </div>
        </div>
        <a href="https://${portale}" style="display:inline-block;background:#f97316;color:#fff;padding:12px 28px;border-radius:6px;text-decoration:none;font-weight:700;font-size:14px">Accedi al portale →</a>
        <p style="color:#999;font-size:12px;margin-top:20px">⚠️ Cambia la password al primo accesso per sicurezza.</p>
      `)
    })
    return { ok: true }
  } catch (err) {
    console.error('Errore invio email credenziali:', err)
    return { ok: false, error: err }
  }
}

// Invito staff (operatore/agente/admin): link per impostare la password ed entrare
export async function inviaInvitoStaff({
  email, nome, link, masterNome
}: {
  email: string; nome: string; link: string; masterNome: string
}) {
  try {
    await resend.emails.send({
      from: FROM,
      to: email,
      subject: `${masterNome} — Invito ad accedere a MoovExpress`,
      html: wrap(`
        <h2 style="font-size:20px;color:#1a1a1a;margin:0 0 12px">Ciao${nome ? ' ' + nome : ''}!</h2>
        <p style="color:#666;font-size:14px;line-height:1.6;margin:0 0 20px">${masterNome} ti ha invitato come membro dello staff su MoovExpress. Imposta la tua password per accedere.</p>
        <a href="${link}" style="display:inline-block;background:#f97316;color:#fff;padding:12px 28px;border-radius:6px;text-decoration:none;font-weight:700;font-size:14px">Imposta password e accedi →</a>
        <p style="color:#999;font-size:12px;margin-top:20px">Se non ti aspettavi questo invito, ignora questa email.</p>
      `)
    })
    return { ok: true }
  } catch (err) {
    console.error('Errore invio invito staff:', err)
    return { ok: false, error: err }
  }
}

// Escape minimo per interpolare testo utente nell'HTML delle email
function esc(v: any): string { return String(v ?? '').replace(/</g, '&lt;').replace(/>/g, '&gt;') }
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// NOTIFICA "SPEDIZIONE CREATA" — email brand MoovExpress al MITTENTE e al DESTINATARIO.
// Le email vere NON vanno mai ai provider (li' va l'email schermo): ai clienti finali scriviamo NOI.
// Mai nomi dei provider: solo il nome del contratto corriere. Best-effort: non fallisce mai.
export async function inviaEmailSpedizioneCreata(p: {
  mittEmail?: string | null; destEmail?: string | null
  mittNome?: string | null; destNome?: string | null
  numero: string; corriere?: string | null; destCitta?: string | null
  notificaDest?: boolean   // impostazione cliente notifica_email_dest (default true)
}) {
  const corriere = esc((p.corriere || '').trim())
  const mitt = String(p.mittEmail || '').trim().toLowerCase()
  const dest = String(p.destEmail || '').trim().toLowerCase()
  // Al MITTENTE: conferma con numero spedizione
  if (EMAIL_RE.test(mitt)) {
    try {
      await resend.emails.send({
        from: FROM, to: mitt,
        subject: `Spedizione ${p.numero} creata \u2705`,
        html: wrap(`
          <h2 style="font-size:20px;color:#1a1a1a;margin:0 0 12px">Spedizione creata \u2705</h2>
          <p style="color:#666;font-size:14px;line-height:1.6;margin:0 0 10px">La spedizione <strong>${esc(p.numero)}</strong> per <strong>${esc(p.destNome || 'il destinatario')}</strong>${p.destCitta ? ` (${esc(p.destCitta)})` : ''} \u00e8 stata creata correttamente.</p>
          ${corriere ? `<p style="color:#666;font-size:14px;margin:0 0 10px">Corriere: <strong>${corriere}</strong></p>` : ''}
          <p style="color:#999;font-size:13px;margin-top:14px">Conserva il numero di spedizione per seguirne il tracking dal portale.</p>
        `),
      })
    } catch { /* best-effort */ }
  }
  // Al DESTINATARIO (se abilitato dalle impostazioni del cliente, e se diverso dal mittente)
  if ((p.notificaDest ?? true) && EMAIL_RE.test(dest) && dest !== mitt) {
    try {
      await resend.emails.send({
        from: FROM, to: dest,
        subject: `Un pacco sta arrivando \ud83d\udce6 \u2014 spedizione ${p.numero}`,
        html: wrap(`
          <h2 style="font-size:20px;color:#1a1a1a;margin:0 0 12px">Un pacco sta arrivando \ud83d\udce6</h2>
          <p style="color:#666;font-size:14px;line-height:1.6;margin:0 0 10px"><strong>${esc(p.mittNome || 'Un mittente')}</strong> ti ha inviato una spedizione.</p>
          <p style="color:#666;font-size:14px;margin:0 0 10px">Numero spedizione: <strong>${esc(p.numero)}</strong>${corriere ? ` \u2014 Corriere: <strong>${corriere}</strong>` : ''}</p>
          <p style="color:#999;font-size:13px;margin-top:14px">Con questo numero puoi seguire la consegna sul sito del corriere.</p>
        `),
      })
    } catch { /* best-effort */ }
  }
}
