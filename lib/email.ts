import { Resend } from 'resend'

const resend = new Resend(process.env.RESEND_API_KEY)
// Mittente con NOME VISIBILE: se la env contiene solo l'indirizzo (noreply@...), Gmail mostrava
// "noreply" come nome — qui garantiamo sempre "MoovExpress <indirizzo>".
const FROM_RAW = process.env.EMAIL_FROM || 'MoovExpress <onboarding@resend.dev>'
const FROM = FROM_RAW.includes('<') ? FROM_RAW : `MoovExpress <${FROM_RAW}>`

// Intestazione/footer comuni MoovExpress
function wrap(inner: string): string {
  return `
  <div style="font-family:sans-serif;max-width:520px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e8e8e8">
    <div style="background:#1a1a1a;padding:20px 32px">
      <img src="https://zxwykadbgvnllnnegnuh.supabase.co/storage/v1/object/public/loghi/logo-a99cce52-7e74-4849-b755-10cb6274f392.png" alt="MoovExpress" width="133" height="40" style="display:block;height:40px;width:auto;border:0" />
    </div>
    <div style="padding:32px">${inner}</div>
  </div>`
}

// Wrap BRANDIZZATO col logo/colore del MASTER (fallback MoovExpress). Non tocca wrap() (le altre email).
function wrapBrand(inner: string, b: { logo?: string | null; colore?: string | null; nome?: string | null }): string {
  const colore = b.colore || '#1a1a1a'
  const header = b.logo
    ? `<img src="${b.logo}" alt="logo" style="display:block;max-height:44px;max-width:200px;height:auto;border:0" />`
    : `<div style="color:#fff;font-size:20px;font-weight:800">${esc(b.nome || 'Preventivo')}</div>`
  return `
  <div style="font-family:sans-serif;max-width:560px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e8e8e8">
    <div style="background:${colore};padding:20px 28px">${header}</div>
    <div style="padding:30px">${inner}</div>
  </div>`
}

// Email del PREVENTIVO al destinatario: brandizzata (logo+colore del master) con link alla pagina pubblica.
export async function inviaEmailPreventivo({ to, oggetto, destNome, link, master }: {
  to: string; oggetto?: string; destNome?: string; link: string
  master: { nome?: string | null; logo_url?: string | null; colore_primario?: string | null; colore_secondario?: string | null }
}): Promise<{ ok: boolean; error?: string }> {
  try {
    const colP = master.colore_primario || '#f97316'
    const r: any = await resend.emails.send({
      from: FROM,
      to,
      subject: oggetto || `Preventivo${master.nome ? ' da ' + master.nome : ''}`,
      html: wrapBrand(`
        <h2 style="font-size:19px;color:#1a1a1a;margin:0 0 10px">${esc(oggetto || 'Il tuo preventivo')}</h2>
        <p style="color:#555;font-size:14px;line-height:1.6;margin:0 0 18px">${destNome ? 'Ciao ' + esc(destNome) + ', ' : ''}ecco il preventivo${master.nome ? ' di ' + esc(master.nome) : ''}. Aprilo per vedere i prezzi e, se ti va bene, accettarlo con un clic.</p>
        <p style="text-align:center;margin:22px 0"><a href="${link}" style="background:${colP};color:#fff;text-decoration:none;border-radius:8px;padding:12px 26px;font-size:14px;font-weight:700;display:inline-block">Vedi e accetta il preventivo</a></p>
        <p style="color:#999;font-size:12px;margin-top:16px;word-break:break-all">Oppure copia questo link: ${link}</p>
      `, { logo: master.logo_url, colore: master.colore_secondario, nome: master.nome }),
    })
    if (r?.error) return { ok: false, error: r.error?.message || JSON.stringify(r.error) }
    return { ok: true }
  } catch (err: any) { return { ok: false, error: String(err?.message || err) } }
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
// areaStaff = l'account NON e' un cliente (master, admin, operatore, agente): va mandato al
// Control Center, non al portale clienti. Prima ricevevano tutti la stessa email con scritto
// "Accedi al portale cliente": ci andavano, il portale li respingeva e si convincevano che le
// credenziali fossero sbagliate. E' successo davvero (agente di Ecomize Solution, 28/07).
export async function inviaCredenzialiCliente({
  email, nomeCliente, masterNome, dominio, password, areaStaff = false
}: {
  email: string; nomeCliente: string; masterNome: string; dominio: string; password: string; areaStaff?: boolean
}) {
  const portale = dominio || 'moovexpress.com'
  const indirizzoPortale = areaStaff ? portale : `${portale}/cliente`
  const linkPortale = `https://${indirizzoPortale}`
  const testoPulsante = areaStaff ? 'Accedi al Control Center →' : 'Accedi al portale cliente →'
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
            <strong style="color:#1a1a1a;font-family:monospace">${indirizzoPortale}</strong>
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
        <!-- Ogni destinatario alla SUA porta: i clienti al portale cliente, lo staff (master,
             admin, operatore, agente) al Control Center. Mandarli tutti su /cliente faceva
             sbattere lo staff contro un rifiuto, con le credenziali giuste in mano. -->
        <a href="${linkPortale}" style="display:inline-block;background:#f97316;color:#fff;padding:12px 28px;border-radius:6px;text-decoration:none;font-weight:700;font-size:14px">${testoPulsante}</a>
        <div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:8px;padding:12px 14px;margin-top:20px;font-size:12.5px;color:#9a3412;line-height:1.5">
          <strong>Vale solo QUESTA email.</strong> Ogni volta che la password viene reimpostata ne arriva una nuova e la precedente smette di funzionare: se ne hai ricevute più di una, usa la più recente — questa è del ${new Date().toLocaleString('it-IT', { timeZone: 'Europe/Rome', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}.
          <div style="margin-top:6px">Non ti fa entrare? Dalla pagina di accesso usa <strong>“Password dimenticata?”</strong> e scegli tu la password.</div>
        </div>
        <p style="color:#999;font-size:12px;margin-top:16px">⚠️ Cambia la password al primo accesso per sicurezza.</p>
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

// RECUPERO PASSWORD: link per reimpostarla da soli. Serve perché le credenziali le crea il
// master a mano: senza questa via, chi non le ha mai ricevute o le ha perse resta fuori e deve
// per forza farsi risettare la password da qualcuno.
export async function inviaRecuperoPassword({ email, link }: { email: string; link: string }) {
  try {
    await resend.emails.send({
      from: FROM,
      to: email,
      subject: 'MoovExpress — Reimposta la tua password',
      html: wrap(`
        <h2 style="font-size:20px;color:#1a1a1a;margin:0 0 12px">Reimposta la password</h2>
        <p style="color:#666;font-size:14px;line-height:1.6;margin:0 0 20px">Hai chiesto di accedere di nuovo al tuo portale MoovExpress. Scegli una nuova password con il pulsante qui sotto: il collegamento vale <strong>un'ora</strong> e una volta sola.</p>
        <a href="${link}" style="display:inline-block;background:#f97316;color:#fff;padding:12px 28px;border-radius:6px;text-decoration:none;font-weight:700;font-size:14px">Scegli una nuova password →</a>
        <p style="color:#999;font-size:12px;margin-top:20px">Se non sei stato tu, ignora questa email: la password attuale resta valida.</p>
      `)
    })
    return { ok: true }
  } catch (err) {
    console.error('Errore invio recupero password:', err)
    return { ok: false, error: err }
  }
}

// Escape minimo per interpolare testo utente nell'HTML delle email
function esc(v: any): string { return String(v ?? '').replace(/</g, '&lt;').replace(/>/g, '&gt;') }
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// NOTIFICA "SPEDIZIONE CREATA" — email brand MoovExpress al SOLO DESTINATARIO.
// (La conferma al mittente e' stata rimossa su richiesta: il mittente vive gia' nel portale.)
// Le email vere NON vanno mai ai provider (li' va l'email schermo): ai clienti finali scriviamo NOI.
// Mai nomi dei provider: solo il nome del contratto corriere. Best-effort: non fallisce mai.
export async function inviaEmailSpedizioneCreata(p: {
  mittEmail?: string | null; destEmail?: string | null
  mittNome?: string | null; destNome?: string | null
  numero: string; corriere?: string | null; destCitta?: string | null
  notificaDest?: boolean   // impostazione cliente notifica_email_dest (default true)
  spedizioneId?: string | null   // se presente, dispaccia anche l'SMS di notifica (stesso evento)
  masterId?: string | null   // se è un master DEMO, non parte nulla di reale (email/SMS finti)
}) {
  // Account demo: nessuna email/SMS reale al destinatario. La prova non deve scrivere a nessuno.
  if (p.masterId) {
    try { const { masterEDemo } = await import('@/lib/demo'); if (await masterEDemo(p.masterId)) return } catch { /* best-effort */ }
  }
  // NOTIFICA SMS al destinatario (best-effort, indipendente dall'email): stesso evento "spedizione
  // creata". Gatea da sola sulla preferenza notifica_sms e sul credito SMS; non parte se non c'è il
  // gateway configurato. Sta qui perché ogni porta che manda l'email passa già da questa funzione.
  if (p.spedizioneId) {
    try { const { inviaSmsCreazione } = await import('@/lib/sms'); await inviaSmsCreazione(p.spedizioneId) } catch { /* best-effort */ }
  }
  const corriere = esc((p.corriere || '').trim())
  const dest = String(p.destEmail || '').trim().toLowerCase()
  // Al DESTINATARIO (se abilitato dalle impostazioni del cliente).
  if ((p.notificaDest ?? true) && EMAIL_RE.test(dest)) {
    // Link al tracking del NOSTRO portale (stesso dell'SMS): si ricava dal tracking_token della
    // spedizione. Best-effort: se non lo troviamo, l'email parte comunque senza pulsante.
    let urlTracking: string | null = null
    // REPLY-TO = chi ha fatto la spedizione (il mittente). Senza, il destinatario che risponde alla
    // notifica scriveva a noreply@moovexpress.com → la sua domanda arrivava a NOI, non al cliente che
    // ha spedito. Ordine: mittente della spedizione → email dell'account cliente → mittEmail passato.
    let replyTo: string | undefined
    if (p.spedizioneId) {
      try {
        const { createAdminSupabase } = await import('@/lib/supabase-admin')
        const admin = createAdminSupabase()
        const { data: sp } = await admin.from('spedizioni').select('tracking_token,cliente_id,mitt_email').eq('id', p.spedizioneId).maybeSingle()
        if (sp?.tracking_token) {
          const base = (process.env.NEXT_PUBLIC_APP_URL || 'https://moovexpress.com').replace(/\/$/, '')
          urlTracking = `${base}/traccia/${sp.tracking_token}`
        }
        const mittSp = String(sp?.mitt_email || '').trim().toLowerCase()
        if (EMAIL_RE.test(mittSp)) replyTo = mittSp
        else if (sp?.cliente_id) {
          const { data: cl } = await admin.from('clienti').select('email').eq('id', sp.cliente_id).maybeSingle()
          const ec = String(cl?.email || '').trim().toLowerCase()
          if (EMAIL_RE.test(ec)) replyTo = ec
        }
      } catch { /* best-effort */ }
    }
    if (!replyTo) { const m = String(p.mittEmail || '').trim().toLowerCase(); if (EMAIL_RE.test(m)) replyTo = m }
    const bloccoTracking = urlTracking
      ? `<a href="${urlTracking}" style="display:inline-block;background:#f97316;color:#fff;padding:12px 28px;border-radius:6px;text-decoration:none;font-weight:700;font-size:14px;margin-top:14px">Segui la spedizione \u2192</a>`
      : `<p style="color:#999;font-size:13px;margin-top:14px">Con questo numero puoi seguire la consegna.</p>`
    try {
      await resend.emails.send({
        from: FROM, to: dest, replyTo,
        subject: `Un pacco sta arrivando \ud83d\udce6 \u2014 spedizione ${p.numero}`,
        html: wrap(`
          <h2 style="font-size:20px;color:#1a1a1a;margin:0 0 12px">Un pacco sta arrivando \ud83d\udce6</h2>
          <p style="color:#666;font-size:14px;line-height:1.6;margin:0 0 10px"><strong>${esc(p.mittNome || 'Un mittente')}</strong> ti ha inviato una spedizione.</p>
          <p style="color:#666;font-size:14px;margin:0 0 10px">Numero spedizione: <strong>${esc(p.numero)}</strong>${corriere ? ` \u2014 Corriere: <strong>${corriere}</strong>` : ''}</p>
          ${bloccoTracking}
        `),
      })
    } catch { /* best-effort */ }
  }
}
