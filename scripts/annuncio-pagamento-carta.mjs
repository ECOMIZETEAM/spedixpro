// ANNUNCIO AI MASTER: da agosto il canone si paga con carta.
//
// Di default NON manda niente: stampa a chi andrebbe e il testo esatto. Per mandarle davvero:
//
//   node scripts/annuncio-pagamento-carta.mjs --conferma
//
// Manda una mail sola per master, e la salta a chi non paga (il master principale e gli esenti).
import { readFileSync } from 'fs'
import { createClient } from '@supabase/supabase-js'
import { Resend } from 'resend'

const env = { ...Object.fromEntries(readFileSync('.env.local', 'utf8').split('\n')
  .filter(r => r.includes('=') && !r.trim().startsWith('#'))
  .map(r => [r.slice(0, r.indexOf('=')).trim(), r.slice(r.indexOf('=') + 1).trim()])), ...process.env }

const VERO = process.argv.includes('--conferma')
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

const LOGO = 'https://zxwykadbgvnllnnegnuh.supabase.co/storage/v1/object/public/loghi/logo-a99cce52-7e74-4849-b755-10cb6274f392.png'

const testo = (nome, piano, canone) => `
  <p style="font-size:15px;color:#1a1a1a;margin:0 0 16px">Ciao${nome ? ' ' + nome : ''},</p>

  <p style="font-size:14px;color:#333;line-height:1.6;margin:0 0 16px">
    da agosto il canone del tuo abbonamento MoovExpress si paga <strong>con carta</strong>, con rinnovo
    automatico il primo di ogni mese. Non verrà più scalato dal credito che usi per le spedizioni:
    i due conti restano separati, e per il canone riceverai una fattura a ogni pagamento.
  </p>

  <div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:8px;padding:14px 16px;margin:0 0 16px">
    <div style="font-size:14px;color:#9a3412"><strong>Cosa devi fare</strong></div>
    <div style="font-size:14px;color:#9a3412;line-height:1.6;margin-top:6px">
      Entra nel portale, apri <strong>Abbonamento</strong> e attiva il pagamento con carta.
      Ci vogliono due minuti.${piano ? ` Il tuo piano resta <strong>${piano}</strong>${canone ? ` — € ${canone} al mese` : ''}.` : ''}
    </div>
  </div>

  <p style="font-size:14px;color:#333;line-height:1.6;margin:0 0 16px">
    <strong>Da domenica 3 agosto</strong> chi non ha ancora attivato la carta avrà <strong>3 giorni</strong>
    per farlo. Passati quelli, le spedizioni si sospendono — e con esse quelle dei tuoi clienti e dei tuoi
    sotto-master. Appena il pagamento va a buon fine tutto riparte da solo, senza dover chiedere nulla a nessuno.
  </p>

  <p style="font-size:14px;color:#333;line-height:1.6;margin:0 0 16px">
    Da Abbonamento puoi anche cambiare piano quando vuoi: un piano superiore vale subito e ti viene
    addebitata solo la differenza per i giorni che restano; un piano inferiore parte dal primo del mese
    successivo, così non perdi quello che hai già pagato.
  </p>

  <p style="font-size:14px;color:#333;line-height:1.6;margin:0 0 8px">
    <a href="https://moovexpress.com/dashboard/abbonamento" style="display:inline-block;background:#f97316;color:#fff;text-decoration:none;border-radius:8px;padding:11px 20px;font-weight:700;font-size:14px">Attiva il pagamento</a>
  </p>

  <p style="font-size:13px;color:#777;line-height:1.6;margin:20px 0 0">
    Per qualsiasi dubbio rispondi a questa email o scrivici dall'assistenza nel portale.
  </p>
  <p style="font-size:13px;color:#777;margin:16px 0 0">Il team MoovExpress</p>`

const pagina = (inner) => `
  <div style="font-family:sans-serif;max-width:520px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e8e8e8">
    <div style="background:#1a1a1a;padding:20px 32px">
      <img src="${LOGO}" alt="MoovExpress" width="133" height="40" style="display:block;height:40px;width:auto;border:0" />
    </div>
    <div style="padding:32px">${inner}</div>
  </div>`

const NOMI = { enterprise_5k: 'Enterprise 5K', enterprise_10k: 'Enterprise 10K', enterprise_20k: 'Enterprise 20K',
  enterprise_50k: 'Enterprise 50K', enterprise_80k: 'Enterprise 80K', enterprise_100k: 'Enterprise 100K',
  enterprise_120k: 'Enterprise 120K', enterprise_150k: 'Enterprise 150K' }

const { data: masters } = await db.from('masters')
  .select('id,nome,email,abbonamento_piano,abbonamento_prezzo,abbonamento_esente,parent_master_id,stripe_subscription_id')
  .not('abbonamento_piano', 'is', null)

const destinatari = (masters || []).filter(m =>
  m.parent_master_id && !m.abbonamento_esente && !m.stripe_subscription_id && (m.email || '').includes('@'))

console.log(`\n${VERO ? '📤 INVIO REALE' : '🔍 PROVA — non viene mandato niente'}   destinatari: ${destinatari.length}\n`)
for (const m of destinatari) console.log(`   ${(m.nome || '').padEnd(32)} ${m.email}   ${NOMI[m.abbonamento_piano] || m.abbonamento_piano}`)

const saltati = (masters || []).filter(m => !destinatari.includes(m))
if (saltati.length) {
  console.log(`\n   saltati (${saltati.length}):`)
  for (const m of saltati) {
    const perche = !m.parent_master_id ? 'master principale' : m.abbonamento_esente ? 'esente' :
      m.stripe_subscription_id ? 'ha gia la carta' : 'email mancante'
    console.log(`     ${(m.nome || '').padEnd(32)} — ${perche}`)
  }
}

if (!VERO) {
  console.log('\n──── ANTEPRIMA DEL TESTO ────')
  console.log(testo('Mario', 'Enterprise 5K', '139').replace(/<[^>]+>/g, ' ').replace(/\s{2,}/g, ' ').trim())
  console.log('\nPer mandarle davvero:  node scripts/annuncio-pagamento-carta.mjs --conferma\n')
  process.exit(0)
}

const resend = new Resend(env.RESEND_API_KEY)
const FROM_RAW = env.EMAIL_FROM || 'MoovExpress <noreply@moovexpress.com>'
const FROM = FROM_RAW.includes('<') ? FROM_RAW : `MoovExpress <${FROM_RAW}>`
let ok = 0, ko = 0
for (const m of destinatari) {
  try {
    const r = await resend.emails.send({
      from: FROM, to: m.email,
      subject: 'MoovExpress — il canone passa al pagamento con carta',
      html: pagina(testo(m.nome, NOMI[m.abbonamento_piano] || '', m.abbonamento_prezzo)),
    })
    if (r?.error) { console.log(`   ❌ ${m.email}: ${r.error.message}`); ko++ }
    else { console.log(`   ✅ ${m.email}`); ok++ }
  } catch (e) { console.log(`   ❌ ${m.email}: ${e.message}`); ko++ }
  await new Promise(r => setTimeout(r, 600))   // il servizio email ha un limite al secondo
}
console.log(`\nInviate: ${ok}   fallite: ${ko}\n`)
