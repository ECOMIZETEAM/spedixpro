import crypto from 'crypto'

// CREDENZIALI DEI NEGOZI CIFRATE A RIPOSO (AES-256-GCM).
//
// Amazon chiede che le credenziali SP-API (il refresh token che il venditore ci affida quando
// collega il suo account) non stiano mai in chiaro. Il database e' gia' cifrato su disco, ma chi
// legge la riga — un backup, un'esportazione, una query di servizio — vedrebbe il token e potrebbe
// usarlo. Cifrato con una chiave che vive SOLO nelle variabili d'ambiente di Vercel, il database da
// solo non basta.
//
// ROTAZIONE. `INTEGRAZIONI_CHIAVI_CIFRATURA` = "id:chiaveBase64,id:chiaveBase64,…", 32 byte ciascuna.
// La PRIMA cifra, tutte decifrano. Per ruotare (Amazon la chiede almeno una volta l'anno): si mette
// la chiave nuova in testa e si lascia la vecchia in coda; ogni volta che una credenziale viene
// riscritta (il rinnovo del token d'accesso la riscrive a ogni ora d'uso) esce cifrata con la nuova.
// Quando nessuna riga porta piu' l'id vecchio, la vecchia si toglie.
//
// Formato salvato: "<id>:<base64(iv 12 byte | tag 16 byte | testo cifrato)>".

type Chiave = { id: string; k: Buffer }

function chiavi(): Chiave[] {
  const voci = (process.env.INTEGRAZIONI_CHIAVI_CIFRATURA || '').split(',').map(s => s.trim()).filter(Boolean)
  const out: Chiave[] = []
  for (const v of voci) {
    const i = v.indexOf(':')
    if (i <= 0) continue
    const id = v.slice(0, i)
    const k = Buffer.from(v.slice(i + 1), 'base64')
    if (/^[a-z0-9]+$/i.test(id) && k.length === 32) out.push({ id, k })
  }
  return out
}

export function cifraturaConfigurata(): boolean {
  return chiavi().length > 0
}

export function cifra(testo: string): string {
  const [attuale] = chiavi()
  if (!attuale) throw new Error('Cifratura delle integrazioni non configurata')
  const iv = crypto.randomBytes(12)
  const c = crypto.createCipheriv('aes-256-gcm', attuale.k, iv)
  const dati = Buffer.concat([c.update(testo, 'utf8'), c.final()])
  return `${attuale.id}:${Buffer.concat([iv, c.getAuthTag(), dati]).toString('base64')}`
}

export function decifra(salvato: string): string {
  const i = salvato.indexOf(':')
  const ch = i > 0 ? chiavi().find(x => x.id === salvato.slice(0, i)) : undefined
  if (!ch) throw new Error('Credenziale cifrata con una chiave che non c\'e\' piu\': ricollega il negozio')
  const buf = Buffer.from(salvato.slice(i + 1), 'base64')
  const d = crypto.createDecipheriv('aes-256-gcm', ch.k, buf.subarray(0, 12))
  d.setAuthTag(buf.subarray(12, 28))
  return Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString('utf8')
}

// La credenziale e' cifrata con la chiave attuale? Serve a ricifrare con la nuova dopo una rotazione.
export function cifrataConChiaveAttuale(salvato: string): boolean {
  const [attuale] = chiavi()
  return !!attuale && salvato.startsWith(attuale.id + ':')
}
