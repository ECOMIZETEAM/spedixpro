import dns from 'dns/promises'
import net from 'net'

// SSRF: un indirizzo di negozio lo scrive il CLIENTE, e il server poi lo chiama (woo/prestashop
// connetti, e i giri di sincronizzazione che riusano l'URL salvato). Senza controllo, un cliente puo'
// far puntare quella chiamata alla rete interna: `http://169.254.169.254/...` (metadati del cloud),
// `http://localhost`, un IP privato — e parte della risposta/errore gli torna indietro. Qui si ammette
// solo http(s) verso un host che NON risolve a un indirizzo interno. Il controllo si fa alla CONNESSIONE
// (quando l'URL entra), cosi' non si salva mai un indirizzo interno; resta scoperto solo il DNS-rebinding
// (host pubblico che al giro dopo risolve interno), che e' un attacco a parte.

function ipInterno(ip: string): boolean {
  // IPv4 mappato in IPv6 (::ffff:10.0.0.1) -> si guarda la parte v4.
  const m = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i)
  if (m) ip = m[1]

  if (net.isIPv4(ip)) {
    const p = ip.split('.').map(Number)
    if (p.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return true   // malformato: non fidarsi
    const [a, b] = p
    if (a === 10) return true                                   // 10.0.0.0/8  privato
    if (a === 172 && b >= 16 && b <= 31) return true            // 172.16.0.0/12 privato
    if (a === 192 && b === 168) return true                     // 192.168.0.0/16 privato
    if (a === 127) return true                                  // 127.0.0.0/8 loopback
    if (a === 169 && b === 254) return true                     // 169.254.0.0/16 link-local (metadati cloud)
    if (a === 100 && b >= 64 && b <= 127) return true           // 100.64.0.0/10 CGNAT
    if (a === 0) return true                                    // 0.0.0.0/8
    if (a === 192 && b === 0) return true                       // 192.0.0.0/24 e 192.0.2.0/24
    if (a >= 224) return true                                   // multicast/riservati (224+)
    return false
  }

  if (net.isIPv6(ip)) {
    const x = ip.toLowerCase()
    if (x === '::1' || x === '::') return true                  // loopback / non specificato
    if (x.startsWith('fe80') || x.startsWith('fe9') || x.startsWith('fea') || x.startsWith('feb')) return true  // fe80::/10 link-local
    if (x.startsWith('fc') || x.startsWith('fd')) return true   // fc00::/7 ULA (private)
    return false
  }

  // Non e' un IP riconoscibile: meglio rifiutare.
  return true
}

export type EsitoUrl = { ok: true; url: string } | { ok: false; errore: string }

/** Verifica che `grezzo` sia un URL http(s) verso un host PUBBLICO. Risolve il DNS e rifiuta se un
 *  qualunque indirizzo risolto e' interno. Da usare prima di fare `fetch` su un URL fornito dall'utente. */
export async function verificaUrlPubblico(grezzo: string): Promise<EsitoUrl> {
  let u: URL
  try { u = new URL(grezzo) } catch { return { ok: false, errore: 'Indirizzo del negozio non valido.' } }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    return { ok: false, errore: 'Sono ammessi solo indirizzi http:// o https://.' }
  }
  const host = u.hostname.replace(/^\[|\]$/g, '')   // toglie le parentesi di un IPv6 letterale
  if (!host || /(^|\.)(localhost|local|internal|localdomain)$/i.test(host)) {
    return { ok: false, errore: 'Indirizzo non consentito.' }
  }

  let indirizzi: string[]
  if (net.isIP(host)) {
    indirizzi = [host]
  } else {
    try {
      const res = await dns.lookup(host, { all: true })
      indirizzi = res.map(r => r.address)
    } catch {
      return { ok: false, errore: 'Impossibile risolvere l’indirizzo del negozio. Controlla l’URL.' }
    }
  }
  if (!indirizzi.length || indirizzi.some(ipInterno)) {
    return { ok: false, errore: 'Indirizzo non consentito (punta a una rete interna).' }
  }
  return { ok: true, url: u.toString() }
}
