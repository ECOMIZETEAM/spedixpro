import { Resend } from 'resend'
import { eIndirizzoInterno } from '@/lib/indirizzi-interni'
import { eSpedizioneDaAmazon } from '@/lib/compratore-amazon'
import { COSA_FARE_ALLARME } from '@/lib/allarmi-sicurezza'

const resend = new Resend(process.env.RESEND_API_KEY)
// Mittente con NOME VISIBILE: se la env contiene solo l'indirizzo (noreply@...), Gmail mostrava
// "noreply" come nome — qui garantiamo sempre "MoovExpress <indirizzo>".
const FROM_RAW = process.env.EMAIL_FROM || 'MoovExpress <onboarding@resend.dev>'
const FROM = FROM_RAW.includes('<') ? FROM_RAW : `MoovExpress <${FROM_RAW}>`

// NON SCRIVIAMO MAI A UN INDIRIZZO INVENTATO DA NOI.
//
// I conti nati dall'installazione Shopify e i conti-ledger delle condivisioni hanno un indirizzo
// costruito da noi (lib/indirizzi-interni.ts) che nessuno legge. Fino al 20/10/2026 stavano su
// moovexpress.app, un dominio non nostro che chiunque poteva registrare: credenziali dal reset del
// master, avviso dogana e recupero password sarebbero arrivati a lui. Sul sottodominio nuovo non li
// riceve nessuno, ma ogni invio torna indietro, e i rimbalzi pesano sulla reputazione del dominio
// d'invio. Sta qui perche' ogni email della piattaforma passa da questo modulo (fuori restano solo
// supporto e contatti del sito, che scrivono a noi, e uno script d'annuncio ai master). Lancia invece
// di rispondere: ogni funzione qui sotto lo intercetta gia' col suo try/catch e risponde ok:false.
// Il reply-to invece NON si tocca: dove debbano arrivare le risposte dei compratori di un negozio
// creato da Shopify non e' ancora deciso, e non lo decide un filtro.
//
// UN RIFIUTO DI RESEND E' UN ERRORE, NON UN SUCCESSO. La libreria resend non lancia quando l'invio
// viene rifiutato (troppe richieste al secondo, quota finita, mittente o indirizzo respinti, Resend
// giu'): restituisce { error }. Quasi tutte le funzioni qui sotto facevano `await invia(...)` e poi
// `return { ok: true }`, quindi un rifiuto risultava "inviato": il reset dalla scheda cliente diceva
// «nuova password inviata via email» senza mostrarla, e il cliente restava fuori senza che nessuno
// lo sapesse; le giacenze venivano segnate come avvisate e non si riprovavano piu' (26/11/2026).
// Si lancia qui, come per gli indirizzi interni, e ogni try/catch risponde ok:false da solo.
// Quando e' la mail in se' a essere sbagliata (indirizzo, mittente, allegato) riprovarla uguale non
// serve: l'errore dice «non valida», la parola con cui giacenze e calendario smettono di riprovare.
const RIFIUTI_DEFINITIVI = new Set(['validation_error', 'missing_required_field', 'invalid_parameter', 'invalid_from_address', 'invalid_attachment'])
async function invia(msg: Parameters<typeof resend.emails.send>[0]) {
  const destinatari = ([] as string[]).concat(msg.to).filter((e) => !eIndirizzoInterno(e))
  if (!destinatari.length) {
    console.warn('[EMAIL] destinatario inventato da noi: email non spedita —', msg.subject)
    throw new Error('destinatario interno: email non spedita')
  }
  const r = await resend.emails.send({ ...msg, to: destinatari })
  if (r.error) {
    const nome = String((r.error as any).name || 'errore')
    // L'oggetto aiuta a capire QUALE mail e' saltata, ma quello del codice di accesso contiene il codice.
    const oggetto = /codice di accesso/i.test(String(msg.subject)) ? 'Codice di accesso (nascosto)' : msg.subject
    console.error('[EMAIL] Resend ha rifiutato:', nome, '—', r.error.message, '—', oggetto)
    throw new Error(RIFIUTI_DEFINITIVI.has(nome)
      ? `email non valida per Resend (${nome}): ${r.error.message}`
      : `Resend ha rifiutato l'invio (${nome}): ${r.error.message}`)
  }
  return r
}

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
    await invia({
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
    return { ok: true }
  } catch (err: any) { return { ok: false, error: String(err?.message || err) } }
}

// Il codice della verifica in due passaggi via mail (lib/verifica-mail). Il codice sta anche
// nell'oggetto: lo si legge gia' dalla notifica del telefono, senza aprire la mail.
export async function inviaCodiceAccesso({ to, codice, minuti }: { to: string; codice: string; minuti: number }): Promise<{ ok: boolean; error?: string }> {
  try {
    await invia({
      from: FROM,
      to,
      subject: `Codice di accesso MoovExpress: ${codice}`,
      html: wrap(`
        <h2 style="font-size:19px;color:#1a1a1a;margin:0 0 10px">Il tuo codice di accesso</h2>
        <p style="color:#555;font-size:14px;line-height:1.6;margin:0 0 6px">Per entrare in MoovExpress scrivi questo codice:</p>
        <p style="font-size:32px;letter-spacing:8px;font-weight:800;color:#1a1a1a;text-align:center;margin:20px 0">${esc(codice)}</p>
        <p style="color:#555;font-size:14px;line-height:1.6;margin:0 0 18px">Vale ${minuti} minuti e si può usare una volta sola.</p>
        <p style="color:#999;font-size:12px;line-height:1.5;margin:0">Se non stai provando ad accedere tu, qualcuno conosce la tua password: cambiala subito con «Password dimenticata» nella pagina di accesso.</p>
      `),
    })
    return { ok: true }
  } catch (err: any) { return { ok: false, error: String(err?.message || err) } }
}

// Email di prova (verifica dominio/mittente Resend). Ritorna esito + id Resend o errore.
export async function inviaEmailTest(to: string): Promise<{ ok: boolean; from: string; id?: string | null; error?: string }> {
  try {
    const r: any = await invia({
      from: FROM,
      to,
      subject: 'Test email — MoovExpress ✅',
      html: wrap(`
        <h2 style="font-size:20px;color:#1a1a1a;margin:0 0 12px">✅ Email di prova riuscita</h2>
        <p style="color:#666;font-size:14px;line-height:1.6;margin:0 0 12px">Se stai leggendo questa email, l'invio dal dominio <strong>moovexpress.com</strong> tramite Resend funziona correttamente.</p>
        <p style="color:#999;font-size:12px;margin-top:16px">Mittente: ${FROM}</p>
      `),
    })
    return { ok: true, from: FROM, id: r?.data?.id || null }
  } catch (err: any) {
    return { ok: false, from: FROM, error: String(err?.message || err) }
  }
}

// Avviso al CLIENTE: una sua spedizione internazionale è ferma in dogana e servono documenti per
// sbloccarla (EORI, contenuto dettagliato, email destinatario). A differenza di
// inviaEmailSpedizioneCreata ritorna {ok,error} e NON ha effetti collaterali (niente SMS).
// Brandizzata col master (logo+nome) se disponibile. Chiamata dal cron dogana-bloccata.
export async function inviaEmailDoganaFerma({ to, destNome, numero, paese, masterId, link }: {
  to: string; destNome?: string | null; numero: string; paese?: string | null; masterId?: string | null; link?: string | null
}): Promise<{ ok: boolean; error?: string }> {
  try {
    let brand: { logo?: string | null; nome?: string | null } | null = null
    let from = FROM
    if (masterId) {
      const { createAdminSupabase } = await import('@/lib/supabase-admin')
      const { data: mb } = await createAdminSupabase().from('masters').select('logo_url,nome').eq('id', masterId).maybeSingle()
      if (mb?.logo_url || mb?.nome) {
        brand = { logo: mb.logo_url, nome: mb.nome }
        const addr = FROM.match(/<([^>]+)>/)?.[1] || FROM
        if (mb?.nome) from = `${String(mb.nome).replace(/["<>]/g, '').slice(0, 60)} <${addr}>`
      }
    }
    const inner = `
      <h2 style="font-size:19px;color:#1a1a1a;margin:0 0 10px">Servono documenti doganali per la tua spedizione</h2>
      <p style="color:#555;font-size:14px;line-height:1.6;margin:0 0 14px">${destNome ? 'Ciao ' + esc(destNome) + ', ' : ''}la spedizione <strong>${esc(numero)}</strong>${paese ? ' verso ' + esc(paese) : ''} non è ancora partita: il corriere emette la lettera di vettura solo dopo aver ricevuto alcuni dati obbligatori per l'esportazione:</p>
      <ul style="color:#555;font-size:14px;line-height:1.7;margin:0 0 16px;padding-left:20px">
        <li><strong>Codice EORI</strong> del mittente (l'identificativo doganale dell'esportatore)</li>
        <li><strong>Contenuto dettagliato</strong> della spedizione, articolo per articolo, con il valore di ciascuno</li>
        <li><strong>Email del destinatario</strong></li>
      </ul>
      <p style="color:#555;font-size:14px;line-height:1.6;margin:0 0 16px">${link ? 'Apri il ticket qui sotto e allega questi dati' : 'Rispondi a questo messaggio allegando questi dati'}: li inoltriamo subito al corriere per sbloccare la spedizione.</p>
      ${link ? `<p style="text-align:center;margin:22px 0"><a href="${link}" style="background:#f97316;color:#fff;text-decoration:none;border-radius:8px;padding:12px 26px;font-size:14px;font-weight:700;display:inline-block">Apri il ticket e invia i documenti</a></p>` : ''}
    `
    const html = brand ? wrapBrand(inner, { logo: brand.logo, nome: brand.nome }) : wrap(inner)
    await invia({ from, to, subject: `Spedizione ${numero}: servono documenti doganali`, html })
    return { ok: true }
  } catch (err: any) { return { ok: false, error: String(err?.message || err) } }
}

// Auto-registrazione rivenditore: conferma "richiesta ricevuta, in revisione" con link allo stato.
export async function inviaRichiestaPartner({ to, nome, piano, link }: {
  to: string; nome?: string; piano?: string; link: string
}): Promise<{ ok: boolean }> {
  try {
    await invia({
      from: FROM, to,
      subject: 'Richiesta ricevuta — MoovExpress',
      html: wrap(`
        <h2 style="font-size:20px;color:#1a1a1a;margin:0 0 12px">Richiesta ricevuta ✅</h2>
        <p style="color:#555;font-size:14px;line-height:1.6;margin:0 0 12px">${nome ? 'Ciao ' + esc(nome) + ', ' : ''}abbiamo ricevuto la tua richiesta${piano ? ' per il piano <strong>' + esc(piano) + '</strong>' : ''}. È <strong>in revisione</strong>: la verifichiamo e ti ricontattiamo a breve per attivare l'account.</p>
        <p style="text-align:center;margin:22px 0"><a href="${link}" style="background:#f97316;color:#fff;text-decoration:none;border-radius:8px;padding:12px 26px;font-size:14px;font-weight:700;display:inline-block">Segui lo stato della richiesta</a></p>
        <p style="color:#999;font-size:12px;margin-top:16px;word-break:break-all">Oppure copia questo link: ${link}</p>
      `),
    })
    return { ok: true }
  } catch { return { ok: false } }
}

// Esito della richiesta rivenditore quando NON approvata (l'approvazione manda invece le credenziali).
export async function inviaRichiestaPartnerRifiutata({ to, nome, motivo }: {
  to: string; nome?: string; motivo?: string
}): Promise<{ ok: boolean }> {
  try {
    await invia({
      from: FROM, to,
      subject: 'Aggiornamento sulla tua richiesta — MoovExpress',
      html: wrap(`
        <h2 style="font-size:20px;color:#1a1a1a;margin:0 0 12px">Aggiornamento sulla tua richiesta</h2>
        <p style="color:#555;font-size:14px;line-height:1.6;margin:0 0 12px">${nome ? 'Ciao ' + esc(nome) + ', ' : ''}grazie per l'interesse in MoovExpress. Al momento non possiamo dare seguito alla richiesta${motivo ? ': ' + esc(motivo) : '.'}</p>
        <p style="color:#555;font-size:14px;line-height:1.6;margin:0 0 12px">Se pensi ci sia un errore o vuoi parlarne, rispondi pure a questa email.</p>
      `),
    })
    return { ok: true }
  } catch { return { ok: false } }
}

// Avviso "sessione OneTracking scaduta" al master radice: il controllo automatico ripesature e' in
// pausa finche' non incolla un cookie fresco. Mandata UNA volta per scadenza (anti-spam nel worker).
export async function inviaAllertaOneTracking(to: string, arretrato?: number): Promise<{ ok: boolean }> {
  if (!to) return { ok: false }
  try {
    await invia({
      from: FROM, to,
      subject: '⚠️ OneTracking: sessione non valida — ripesature in pausa',
      html: wrap(`
        <h2 style="font-size:20px;color:#1a1a1a;margin:0 0 12px">Sessione OneTracking non valida</h2>
        <p style="color:#666;font-size:14px;line-height:1.6;margin:0 0 12px">La lettura delle misure dal corriere è <strong>ferma</strong>.${arretrato ? ` In coda ci sono <strong>${arretrato}</strong> consegne da controllare.` : ''}</p>
        <p style="color:#666;font-size:14px;line-height:1.6;margin:0 0 12px">Il login si rifà da solo sul Mac tre volte al giorno: se l'avviso torna domani, guarda <code>/tmp/moove-onetracking.log</code> — vuol dire che le credenziali o il form di Poste sono cambiati.</p>
      `),
    })
    return { ok: true }
  } catch (err: any) {
    console.error('[OT] allerta email non inviata:', err?.message || err)
    return { ok: false }
  }
}

// LA SENTINELLA, una volta al giorno. Si manda ANCHE quando e' tutto verde, di proposito: una
// sentinella silenziosa non si distingue da una morta, e il guasto che ha fatto nascere tutto questo
// (il recupero ripesature fermo dal 31/08/2026 al 11/09) non produceva errori — produceva silenzio.
type RigaControllo = { area: string; controllo: string; valore: number; atteso: string; allarme: boolean }

export async function inviaControlloGiornaliero(to: string, righe: RigaControllo[]): Promise<{ ok: boolean }> {
  if (!to || !righe.length) return { ok: false }
  try {
    // Resend non lancia quando rifiuta la mail: risponde con `error`. Prima la rotta diceva "mail inviata" lo stesso.
    const r: any = await invia({ from: FROM, to, ...componiControlloGiornaliero(righe) })
    if (r?.error) throw new Error(r.error.message || String(r.error))
    return { ok: true }
  } catch (err: any) {
    console.error('[SENTINELLA] email non inviata:', err?.message || err)
    return { ok: false }
  }
}

// Oggetto e corpo della mail della Sentinella, separati dall'invio: cosi' un'anteprima mostra la mail esatta che
// arriva, senza mandarla.
export function componiControlloGiornaliero(righe: RigaControllo[]): { subject: string; html: string } {
  const allarmi = righe.filter(r => r.allarme)
  const num = (v: number) => Number(v).toLocaleString('it-IT')
  const riga = (r: typeof righe[number]) => `
    <tr>
      <td style="padding:7px 10px;border-bottom:1px solid #eee;font-size:13px;color:${r.allarme ? '#b91c1c' : '#374151'}">${r.allarme ? '⚠️ ' : ''}${r.controllo}</td>
      <td style="padding:7px 10px;border-bottom:1px solid #eee;font-size:13px;text-align:right;font-weight:700;color:${r.allarme ? '#b91c1c' : '#1a1a1a'}">${num(r.valore)}</td>
      <td style="padding:7px 10px;border-bottom:1px solid #eee;font-size:12px;color:#9ca3af">${r.atteso}</td>
    </tr>`
  return {
      subject: allarmi.length
        ? `⚠️ MoovExpress — ${allarmi.length} ${allarmi.length === 1 ? 'cosa da guardare' : 'cose da guardare'}`
        : '✅ MoovExpress — tutto a posto',
      html: wrap(`
        <h2 style="font-size:20px;color:#1a1a1a;margin:0 0 4px">Controllo giornaliero</h2>
        <p style="color:#666;font-size:14px;line-height:1.6;margin:0 0 16px">
          ${allarmi.length
            ? `<strong style="color:#b91c1c">${allarmi.length} ${allarmi.length === 1 ? 'punto' : 'punti'} da guardare</strong>, in cima all'elenco.`
            : 'Nessun problema: soldi, tracking, ripesature, pesi e resi hanno lavorato tutti nelle ultime 24 ore.'}
        </p>
        <table style="width:100%;border-collapse:collapse;background:#fff;border:1px solid #eee;border-radius:8px">
          ${[...allarmi, ...righe.filter(r => !r.allarme)].map(riga).join('')}
        </table>
        <p style="color:#9ca3af;font-size:12px;line-height:1.6;margin:14px 0 0">
          Quasi tutte le voci guardano se <em>e' successo qualcosa</em>, non se c'e' un errore: un giro
          che smette di partire non lascia errori, lascia silenzio.
        </p>
      `),
  }
}

// ALLARMI DI SICUREZZA (/api/controllo/allarmi, ogni 15 minuti, solo quando c'e' qualcosa di nuovo).
// Per ogni allarme: cosa e' successo, chi, quando e cosa fare (lib/allarmi-sicurezza: lo stesso testo
// della pagina Allarmi di sicurezza). Risponde ok solo se Resend ha preso l'email: se no gli allarmi
// restano "da spedire" e riparte al giro dopo.
export async function inviaAllarmiSicurezza(to: string, allarmi: { tipo: string; descrizione: string; chi: string; quando: string }[]): Promise<{ ok: boolean }> {
  if (!to || !allarmi.length) return { ok: false }
  const esc = (t: string) => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' } as any)[c])
  const blocco = (a: typeof allarmi[number]) => `
    <div style="border:1px solid #fecaca;background:#fff7f7;border-radius:8px;padding:12px 14px;margin:0 0 10px">
      <div style="font-size:14px;color:#b91c1c;font-weight:700;margin:0 0 4px">${esc(a.descrizione)}</div>
      <div style="font-size:12px;color:#6b7280;margin:0 0 6px">${esc(a.quando)}${a.chi ? ` · ${esc(a.chi)}` : ''}</div>
      <div style="font-size:13px;color:#374151;line-height:1.5">${esc(COSA_FARE_ALLARME[a.tipo] || 'Va guardato.')}</div>
    </div>`
  try {
    await invia({
      from: FROM, to,
      subject: `🚨 MoovExpress — ${allarmi.length === 1 ? 'allarme di sicurezza' : `${allarmi.length} allarmi di sicurezza`}`,
      html: wrap(`
        <h2 style="font-size:20px;color:#1a1a1a;margin:0 0 4px">Allarme di sicurezza</h2>
        <p style="color:#666;font-size:14px;line-height:1.6;margin:0 0 16px">
          I registri hanno visto qualcosa fuori dal normale. Non vuol dire per forza un attacco, ma va guardato.
        </p>
        ${allarmi.map(blocco).join('')}
        <p style="color:#9ca3af;font-size:12px;line-height:1.6;margin:14px 0 0">
          Ogni allarme va esaminato e l'esito scritto: lo chiede Amazon (politica sui dati, punto 2.6.2).
          Lo stesso fatto non si ripete prima di un'ora.
        </p>
      `),
    })
    return { ok: true }
  } catch (err: any) {
    console.error('[ALLARMI] email non inviata:', err?.message || err)
    return { ok: false }
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
    await invia({
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
    await invia({
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

// RICHIESTA DI CHIUSURA DELL'ACCOUNT di un collaboratore, agente o autista (app/api/account/chiusura).
// Va al master perche' quell'accesso lo crea e lo toglie il titolare dalla pagina Staff: nei ticket
// questi ruoli non hanno un posto. Non cancella niente, avvisa: decide il titolare.
export async function inviaRichiestaChiusuraAccount(p: {
  to: string; masterNome: string; persona: string; email: string; ruolo: string; motivo: string
}): Promise<{ ok: boolean }> {
  try {
    const chi = esc(p.persona || p.email)
    await invia({
      from: FROM,
      to: p.to,
      subject: `MoovExpress — Richiesta di chiusura dell'account di ${p.persona || p.email}`,
      html: wrap(`
        <h2 style="font-size:20px;color:#1a1a1a;margin:0 0 12px">Richiesta di chiusura dell'account</h2>
        <p style="color:#666;font-size:14px;line-height:1.6;margin:0 0 14px"><strong>${chi}</strong>${p.persona ? ` (${esc(p.email)})` : ''}, ${esc(p.ruolo.toLowerCase())} di <strong>${esc(p.masterNome)}</strong>, ha chiesto di chiudere il proprio accesso a MoovExpress.</p>
        ${p.motivo ? `<p style="color:#666;font-size:14px;line-height:1.6;margin:0 0 14px">Motivo indicato: <em>${esc(p.motivo)}</em></p>` : ''}
        <p style="color:#666;font-size:14px;line-height:1.6;margin:0 0 14px">Non è stato cancellato nulla. Se sei d'accordo, togli l'accesso da <strong>Impostazioni → Staff</strong>: spedizioni, distinte e movimenti restano conservati.</p>
      `)
    })
    return { ok: true }
  } catch (err) {
    console.error('Errore invio richiesta chiusura account:', err)
    return { ok: false }
  }
}

// RECUPERO PASSWORD: link per reimpostarla da soli. Serve perché le credenziali le crea il
// master a mano: senza questa via, chi non le ha mai ricevute o le ha perse resta fuori e deve
// per forza farsi risettare la password da qualcuno.
export async function inviaRecuperoPassword({ email, link }: { email: string; link: string }) {
  try {
    await invia({
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
  // Ordine del collegamento diretto Amazon: ne' email ne' SMS (lib/compratore-amazon).
  if (p.spedizioneId) {
    try {
      const { createAdminSupabase } = await import('@/lib/supabase-admin')
      if (await eSpedizioneDaAmazon(createAdminSupabase(), p.spedizioneId)) return
    } catch { return }
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
    // WHITE-LABEL: l'email che il cliente-del-cliente riceve porta il LOGO + NOME del master (non
    // "MoovExpress"), e parte a NOME del master. Colori STANDARD (header scuro + bottone arancio come
    // le altre email): si eredita solo il MARCHIO, non i colori (scelta di prodotto). Il master lo
    // conosciamo da p.masterId; se non ha logo n\u00e9 nome, si ripiega sul marchio MoovExpress (wrap).
    let brandLogo: string | null = null, brandNome: string | null = null
    if (p.masterId) {
      try {
        const { createAdminSupabase } = await import('@/lib/supabase-admin')
        const { data: mb } = await createAdminSupabase().from('masters').select('logo_url,nome').eq('id', p.masterId).maybeSingle()
        brandLogo = (mb as any)?.logo_url || null
        brandNome = (mb as any)?.nome || null
      } catch { /* best-effort: fallback MoovExpress */ }
    }
    const fromAddr = FROM.match(/<([^>]+)>/)?.[1] || FROM
    const fromBrand = brandNome ? `${brandNome.replace(/["<>]/g, '').slice(0, 60)} <${fromAddr}>` : FROM
    const corpo = `
          <h2 style="font-size:20px;color:#1a1a1a;margin:0 0 12px">Un pacco sta arrivando \ud83d\udce6</h2>
          <p style="color:#666;font-size:14px;line-height:1.6;margin:0 0 10px"><strong>${esc(p.mittNome || 'Un mittente')}</strong> ti ha inviato una spedizione.</p>
          <p style="color:#666;font-size:14px;margin:0 0 10px">Numero spedizione: <strong>${esc(p.numero)}</strong>${corriere ? ` \u2014 Corriere: <strong>${corriere}</strong>` : ''}</p>
          ${bloccoTracking}
        `
    try {
      await invia({
        from: fromBrand, to: dest, replyTo,
        subject: `Un pacco sta arrivando \ud83d\udce6 \u2014 spedizione ${p.numero}`,
        // header scuro col logo del master (colore default #1a1a1a di wrapBrand); fallback MoovExpress.
        html: (brandLogo || brandNome) ? wrapBrand(corpo, { logo: brandLogo, nome: brandNome }) : wrap(corpo),
      })
    } catch { /* best-effort */ }
  }
}

// AVVISO DI GIACENZA AL DESTINATARIO.
//
// Quando il corriere non consegna, Poste e BRT mandano al destinatario un link per riprogrammare —
// nuova data, oppure ritiro in un punto vicino. Quel link al destinatario NON arriva mai: ai provider
// passiamo l'email di servizio (EMAIL_PER_CORRIERE), non quella vera. E' voluto, il provider non deve
// poter contattare il cliente finale del nostro cliente. Ma il risultato e' che il destinatario non
// sa di avere un pacco fermo e non ha modo di dire dove vuole che glielo portino: il pacco resta li'
// finche' scade e torna indietro. Su 387 giacenze in 30 giorni, 133 non sono mai state svincolate.
//
// Allora glielo scriviamo NOI, che le email vere le abbiamo. Stessa scelta gia' fatta per la
// spedizione creata: ai clienti finali scriviamo noi, mai il provider.
//
// NON offre un pulsante per riprogrammare: riconsegna e cambio indirizzo COSTANO e li addebita il
// cliente. Farli partire dal destinatario vorrebbe dire addebitare il mittente senza chiederglielo.
// Il reply-to e' il mittente: il destinatario risponde dicendo cosa vuole, e il mittente esegue lo
// svincolo dal portale, dove quel flusso esiste gia'.
export async function inviaEmailGiacenza(p: {
  destEmail?: string | null; destNome?: string | null
  mittEmail?: string | null; mittNome?: string | null
  numero: string; corriere?: string | null; motivo?: string | null
  trackingToken?: string | null
  masterId?: string | null
  notificaDest?: boolean
  spedizioneId?: string | null
}): Promise<{ ok: boolean; error?: string }> {
  const dest = String(p.destEmail || '').trim().toLowerCase()
  if (!(p.notificaDest ?? true)) return { ok: false, error: 'notifiche disattivate dal cliente' }
  if (!EMAIL_RE.test(dest)) return { ok: false, error: 'email destinatario non valida' }
  // Master in prova: non si scrive a nessuno di vero.
  if (p.masterId) {
    try { const { masterEDemo } = await import('@/lib/demo'); if (await masterEDemo(p.masterId)) return { ok: false, error: 'master demo' } } catch { /* best-effort */ }
  }
  // Ordine del collegamento diretto Amazon: al compratore scrive solo Amazon (lib/compratore-amazon).
  if (p.spedizioneId) {
    try {
      const { createAdminSupabase } = await import('@/lib/supabase-admin')
      if (await eSpedizioneDaAmazon(createAdminSupabase(), p.spedizioneId)) return { ok: false, error: 'ordine Amazon dal collegamento' }
    } catch { return { ok: false, error: 'controllo ordine Amazon non riuscito' } }
  }

  // Marchio del master, come per la spedizione creata: il destinatario non ha mai sentito nominare
  // MoovExpress, conosce il negozio da cui ha comprato e il corriere che glielo porta.
  let brandLogo: string | null = null, brandNome: string | null = null
  if (p.masterId) {
    try {
      const { createAdminSupabase } = await import('@/lib/supabase-admin')
      const { data: mb } = await createAdminSupabase().from('masters').select('logo_url,nome').eq('id', p.masterId).maybeSingle()
      brandLogo = (mb as any)?.logo_url || null
      brandNome = (mb as any)?.nome || null
    } catch { /* best-effort */ }
  }

  const base = (process.env.NEXT_PUBLIC_APP_URL || 'https://moovexpress.com').replace(/\/$/, '')
  const bottone = p.trackingToken
    ? `<a href="${base}/traccia/${p.trackingToken}" style="display:inline-block;background:#f97316;color:#fff;padding:12px 28px;border-radius:6px;text-decoration:none;font-weight:700;font-size:14px;margin-top:6px">Vedi la spedizione \u2192</a>`
    : ''
  const mitt = esc(p.mittNome || 'il mittente')
  const corriere = esc((p.corriere || '').trim())
  const corpo = `
          <h2 style="font-size:20px;color:#1a1a1a;margin:0 0 12px">Il tuo pacco \u00e8 in attesa \ud83d\udce6</h2>
          <p style="color:#666;font-size:14px;line-height:1.6;margin:0 0 10px">Il corriere non \u00e8 riuscito a consegnarti la spedizione <strong>${esc(p.numero)}</strong>${corriere ? ` (${corriere})` : ''}, che ora \u00e8 in giacenza.</p>
          ${p.motivo ? `<p style="color:#666;font-size:14px;margin:0 0 10px">Motivo: <strong>${esc(p.motivo)}</strong></p>` : ''}
          <div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:8px;padding:14px 16px;margin:14px 0">
            <p style="color:#7c2d12;font-size:14px;line-height:1.6;margin:0"><strong>Rispondi a questa email</strong> dicendo come preferisci:
            una nuova data di consegna, un altro indirizzo, oppure il ritiro in un punto vicino a te.
            La richiesta arriva direttamente a ${mitt}, che la gira al corriere.</p>
          </div>
          <p style="color:#999;font-size:13px;line-height:1.6;margin:0 0 6px">Se non ci dici nulla, dopo qualche giorno il pacco torna al mittente.</p>
          ${bottone}
        `
  const fromAddr = FROM.match(/<([^>]+)>/)?.[1] || FROM
  const fromBrand = brandNome ? `${brandNome.replace(/["<>]/g, '').slice(0, 60)} <${fromAddr}>` : FROM
  // REPLY-TO = il mittente: e' lui che puo' davvero muovere la giacenza dal portale.
  const replyTo = EMAIL_RE.test(String(p.mittEmail || '').trim().toLowerCase())
    ? String(p.mittEmail).trim().toLowerCase() : undefined
  try {
    await invia({
      from: fromBrand, to: dest, replyTo,
      subject: `Il tuo pacco \u00e8 in attesa \u2014 spedizione ${p.numero}`,
      html: (brandLogo || brandNome) ? wrapBrand(corpo, { logo: brandLogo, nome: brandNome }) : wrap(corpo),
    })
    return { ok: true }
  } catch (e: any) {
    return { ok: false, error: e?.message || 'invio non riuscito' }
  }
}

// LA PROFORMA AL CLIENTE, col PDF allegato. Parte a nome del master e col suo marchio: il cliente
// compra da lui. Le risposte vanno al master (replyTo), non a noi.
export async function inviaEmailProforma(p: {
  to: string; replyTo?: string | null
  master: { nome: string; logo?: string | null }
  cliente: string; numero: string; dal: string; al: string; totale: number
  pdf: Buffer; nomeFile: string
}): Promise<{ ok: boolean; error?: string }> {
  const dest = String(p.to || '').trim().toLowerCase()
  if (!EMAIL_RE.test(dest)) return { ok: false, error: 'email del cliente non valida' }
  const giorno = (g: string) => `${g.slice(8, 10)}/${g.slice(5, 7)}/${g.slice(0, 4)}`
  const euro = p.totale.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const corpo = `
          <h2 style="font-size:20px;color:#1a1a1a;margin:0 0 12px">Fattura proforma ${esc(p.numero)}</h2>
          <p style="color:#666;font-size:14px;line-height:1.6;margin:0 0 10px">Gentile <strong>${esc(p.cliente)}</strong>,
          in allegato la fattura proforma dei servizi dal <strong>${giorno(p.dal)}</strong> al <strong>${giorno(p.al)}</strong>,
          per un totale di <strong>€ ${euro}</strong> IVA compresa.</p>
          <p style="color:#666;font-size:14px;line-height:1.6;margin:0 0 10px">Nel PDF trovi il riepilogo per voce e, dalla seconda pagina, il dettaglio di ogni movimento.</p>
          <p style="color:#999;font-size:12px;line-height:1.6;margin:14px 0 0">Documento non valido ai fini fiscali. Per qualsiasi domanda rispondi a questa email.</p>
        `
  const fromAddr = FROM.match(/<([^>]+)>/)?.[1] || FROM
  const nome = String(p.master.nome || '').replace(/["<>]/g, '').slice(0, 60)
  const fromBrand = nome ? `${nome} <${fromAddr}>` : FROM
  const replyTo = EMAIL_RE.test(String(p.replyTo || '').trim().toLowerCase()) ? String(p.replyTo).trim().toLowerCase() : undefined
  try {
    await invia({
      from: fromBrand, to: dest, replyTo,
      subject: `Fattura proforma ${p.numero} - ${nome || 'MoovExpress'}`,
      html: wrapBrand(corpo, { logo: p.master.logo || null, nome: nome || null }),
      attachments: [{ filename: p.nomeFile, content: p.pdf }],
    })
    return { ok: true }
  } catch (e: any) {
    return { ok: false, error: e?.message || 'invio non riuscito' }
  }
}

// IL PROMEMORIA DEL CALENDARIO (25/11/2026): a chi l'ha scritto, all'ora dell'avviso. Col marchio del suo master,
// come le altre email che arrivano ai clienti: il cliente conosce il portale col nome di chi gli vende il servizio.
// Nessuna risposta attesa (niente replyTo). Lo manda il giro /api/cron/calendario-avvisi.
export async function inviaEmailPromemoria(p: {
  to: string
  tipo: 'promemoria' | 'evento' | 'riunione'
  titolo: string
  quando: string            // già scritto per esteso, ora di Roma
  luogo?: string | null
  note?: string | null
  spedizione?: string | null
  organizzatore?: string | null   // per chi è invitato: chi ha organizzato
  ripetizione?: string | null     // «Ogni lunedì»
  link: string
  brand?: { logo?: string | null; nome?: string | null }
}): Promise<{ ok: boolean; error?: string }> {
  const dest = String(p.to || '').trim().toLowerCase()
  if (!EMAIL_RE.test(dest)) return { ok: false, error: 'email non valida' }
  const nomeTipo = p.tipo === 'riunione' ? 'Riunione' : p.tipo === 'evento' ? 'Evento' : 'Promemoria'
  const riga = (etichetta: string, valore: string) =>
    `<div style="padding:8px 0;border-bottom:1px solid #efefef;font-size:13px"><span style="color:#999;text-transform:uppercase;font-size:11px;letter-spacing:0.5px;display:block;margin-bottom:2px">${etichetta}</span><span style="color:#1a1a1a">${valore}</span></div>`
  const corpo = `
    <p style="color:#999;font-size:12px;text-transform:uppercase;letter-spacing:0.6px;margin:0 0 6px">${nomeTipo}</p>
    <h2 style="font-size:20px;color:#1a1a1a;margin:0 0 16px;line-height:1.3">${esc(p.titolo)}</h2>
    <div style="background:#f7f7f7;border-radius:8px;padding:6px 16px;margin-bottom:20px">
      ${riga('Quando', esc(p.quando))}
      ${p.ripetizione ? riga('Si ripete', esc(p.ripetizione)) : ''}
      ${p.luogo ? riga('Dove', esc(p.luogo)) : ''}
      ${p.organizzatore ? riga('Organizza', esc(p.organizzatore)) : ''}
      ${p.spedizione ? riga('Spedizione', esc(p.spedizione)) : ''}
      ${p.note ? riga('Note', esc(p.note).replace(/\n/g, '<br>')) : ''}
    </div>
    <a href="${p.link}" style="display:inline-block;background:#1a1a1a;color:#fff;padding:12px 26px;border-radius:999px;text-decoration:none;font-weight:600;font-size:14px">Apri il calendario →</a>
    <p style="color:#999;font-size:12px;line-height:1.6;margin:22px 0 0">Ricevi questa email perché hai chiesto un avviso per questa voce del calendario. Per non riceverne, togli l’avviso dalla voce.</p>
  `
  const nomeBrand = (p.brand?.nome || '').replace(/["<>]/g, '').slice(0, 60)
  const fromAddr = FROM.match(/<([^>]+)>/)?.[1] || FROM
  const from = nomeBrand ? `${nomeBrand} <${fromAddr}>` : FROM
  try {
    await invia({
      from, to: dest,
      subject: `${nomeTipo}: ${p.titolo}`.slice(0, 180),
      html: (p.brand?.logo || p.brand?.nome) ? wrapBrand(corpo, { logo: p.brand?.logo, nome: p.brand?.nome }) : wrap(corpo),
    })
    return { ok: true }
  } catch (e: any) {
    return { ok: false, error: e?.message || 'invio non riuscito' }
  }
}

// L'INVITO A UNA RIUNIONE O A UN EVENTO DEL CALENDARIO (fase 2, 25/11/2026): a chi è invitato, una volta. Col marchio del
// master (chi invita e chi è invitato sono dello stesso master). Si risponde dal calendario, non dall'email.
export async function inviaEmailInvito(p: {
  to: string
  tipo: 'evento' | 'riunione'
  titolo: string
  quando: string
  ripetizione?: string | null
  luogo?: string | null
  note?: string | null
  organizzatore: string
  link: string
  brand?: { logo?: string | null; nome?: string | null }
}): Promise<{ ok: boolean; error?: string }> {
  const dest = String(p.to || '').trim().toLowerCase()
  if (!EMAIL_RE.test(dest)) return { ok: false, error: 'email non valida' }
  const nomeTipo = p.tipo === 'riunione' ? 'riunione' : 'evento'
  const riga = (etichetta: string, valore: string) =>
    `<div style="padding:8px 0;border-bottom:1px solid #efefef;font-size:13px"><span style="color:#999;text-transform:uppercase;font-size:11px;letter-spacing:0.5px;display:block;margin-bottom:2px">${etichetta}</span><span style="color:#1a1a1a">${valore}</span></div>`
  const corpo = `
    <p style="color:#999;font-size:12px;text-transform:uppercase;letter-spacing:0.6px;margin:0 0 6px">Invito</p>
    <h2 style="font-size:20px;color:#1a1a1a;margin:0 0 8px;line-height:1.3">${esc(p.titolo)}</h2>
    <p style="color:#666;font-size:14px;line-height:1.6;margin:0 0 16px"><strong>${esc(p.organizzatore)}</strong> ti ha invitato a questa ${nomeTipo}.</p>
    <div style="background:#f7f7f7;border-radius:8px;padding:6px 16px;margin-bottom:20px">
      ${riga('Quando', esc(p.quando))}
      ${p.ripetizione ? riga('Si ripete', esc(p.ripetizione)) : ''}
      ${p.luogo ? riga('Dove', esc(p.luogo)) : ''}
      ${p.note ? riga('Note', esc(p.note).replace(/\n/g, '<br>')) : ''}
    </div>
    <a href="${p.link}" style="display:inline-block;background:#1a1a1a;color:#fff;padding:12px 26px;border-radius:999px;text-decoration:none;font-weight:600;font-size:14px">Rispondi dal calendario \u2192</a>
    <p style="color:#999;font-size:12px;line-height:1.6;margin:22px 0 0">Dal calendario dici se partecipi; prima dell'inizio ti arriva l'avviso.</p>
  `
  const nomeBrand = (p.brand?.nome || '').replace(/["<>]/g, '').slice(0, 60)
  const fromAddr = FROM.match(/<([^>]+)>/)?.[1] || FROM
  const from = nomeBrand ? `${nomeBrand} <${fromAddr}>` : FROM
  try {
    await invia({
      from, to: dest,
      subject: `Invito: ${p.titolo}`.slice(0, 180),
      html: (p.brand?.logo || p.brand?.nome) ? wrapBrand(corpo, { logo: p.brand?.logo, nome: p.brand?.nome }) : wrap(corpo),
    })
    return { ok: true }
  } catch (e: any) {
    return { ok: false, error: e?.message || 'invio non riuscito' }
  }
}

// IL RIEPILOGO DEL MATTINO DEL CALENDARIO (fase 3, 26/11/2026): alle 7:30, solo a chi l'ha acceso, solo se c'è qualcosa.
// Col marchio del master. Lo manda il giro /api/cron/calendario-riepilogo.
export async function inviaEmailRiepilogo(p: {
  to: string
  giorno: string                                   // «mercoledì 26 novembre»
  voci: { ora: string; titolo: string; sotto?: string | null }[]
  ritiri: number | null                            // null = non vede i ritiri
  giacenze: number | null
  inviti: number
  arretrati: number                                // promemoria rimasti indietro
  link: string
  brand?: { logo?: string | null; nome?: string | null }
}): Promise<{ ok: boolean; error?: string }> {
  const dest = String(p.to || '').trim().toLowerCase()
  if (!EMAIL_RE.test(dest)) return { ok: false, error: 'email non valida' }
  const numero = (n: number, una: string, tante: string) => `<div style="flex:1;min-width:110px;background:#f7f7f7;border-radius:10px;padding:12px 14px"><div style="font-size:22px;font-weight:600;color:#1a1a1a">${n}</div><div style="font-size:12px;color:#888;margin-top:2px">${n === 1 ? una : tante}</div></div>`
  const numeri = [
    p.ritiri != null ? numero(p.ritiri, 'ritiro oggi', 'ritiri oggi') : '',
    p.giacenze != null ? numero(p.giacenze, 'giacenza da gestire', 'giacenze da gestire') : '',
    p.inviti ? numero(p.inviti, 'invito da rispondere', 'inviti da rispondere') : '',
    p.arretrati ? numero(p.arretrati, 'promemoria indietro', 'promemoria indietro') : '',
  ].filter(Boolean).join('')
  const elenco = p.voci.length
    ? p.voci.map((v) => `<div style="display:flex;gap:14px;padding:9px 0;border-bottom:1px solid #efefef;font-size:14px"><span style="color:#888;min-width:52px">${esc(v.ora)}</span><span style="color:#1a1a1a">${esc(v.titolo)}${v.sotto ? `<span style="display:block;color:#999;font-size:12px;margin-top:2px">${esc(v.sotto)}</span>` : ''}</span></div>`).join('')
    : '<p style="color:#888;font-size:14px;margin:0">Nessuna voce in calendario oggi.</p>'
  const corpo = `
    <p style="color:#999;font-size:12px;text-transform:uppercase;letter-spacing:0.6px;margin:0 0 6px">Il tuo giorno</p>
    <h2 style="font-size:20px;color:#1a1a1a;margin:0 0 18px;line-height:1.3">${esc(p.giorno.charAt(0).toUpperCase() + p.giorno.slice(1))}</h2>
    ${numeri ? `<div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:20px">${numeri}</div>` : ''}
    <p style="color:#1a1a1a;font-size:14px;font-weight:600;margin:0 0 6px">In calendario</p>
    <div style="margin-bottom:22px">${elenco}</div>
    <a href="${p.link}" style="display:inline-block;background:#1a1a1a;color:#fff;padding:12px 26px;border-radius:999px;text-decoration:none;font-weight:600;font-size:14px">Apri il calendario →</a>
    <p style="color:#999;font-size:12px;line-height:1.6;margin:22px 0 0">Ricevi questa email perché hai acceso il riepilogo del mattino. Lo spegni dal calendario, alla voce «Notifiche».</p>
  `
  const nomeBrand = (p.brand?.nome || '').replace(/["<>]/g, '').slice(0, 60)
  const fromAddr = FROM.match(/<([^>]+)>/)?.[1] || FROM
  const from = nomeBrand ? `${nomeBrand} <${fromAddr}>` : FROM
  try {
    await invia({
      from, to: dest, subject: `Il tuo giorno: ${p.giorno}`.slice(0, 180),
      html: (p.brand?.logo || p.brand?.nome) ? wrapBrand(corpo, { logo: p.brand?.logo, nome: p.brand?.nome }) : wrap(corpo),
    })
    return { ok: true }
  } catch (e: any) {
    return { ok: false, error: e?.message || 'invio non riuscito' }
  }
}
