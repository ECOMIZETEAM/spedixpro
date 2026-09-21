// Limiti fisici del contratto (numero colli, peso per collo, misure): stessa identica logica che
// stava dentro l'API tariffe, spostata qui perche' serve in DUE momenti diversi.
//
// Nel PREVENTIVO serve a non proporre un corriere che rifiuterebbe la spedizione.
// In CREAZIONE serve a non comprarla: il terzo provider (contratti DVA) non ha alcuna chiamata di
// annullo, quindi una spedizione fuori misura comprata li' e' persa. Il preventivo da solo non
// basta a proteggerci — si puo' arrivare alla creazione con una quotazione vecchia, oppure dalla
// spedizione propria del master, che il preventivo cliente non attraversa.
//
// Tutti i limiti sono OPZIONALI: se il contratto non li configura, nessun controllo scatta.
export function superaLimitiCollo(settings: any, pesoReale: number, colli: any[]): boolean {
  const arr = colli || []
  // N. massimo colli
  const colliMax = Number(settings?.colli_max) || 0
  if (colliMax > 0 && arr.length > colliMax) return true
  // Peso massimo per collo
  const pesoMaxCollo = Number(settings?.peso_max_collo) || 0
  if (pesoMaxCollo > 0 && arr.some((c: any) => (Number(c.weight) || Number(c.peso) || 0) > pesoMaxCollo)) return true
  // Somma dei tre lati (L+W+H). E' un limite DIVERSO da limite_combinato, che usa la formula UPS
  // (lato maggiore + 2×gli altri due): confonderli sbaglierebbe di molto. I contratti del terzo
  // provider dichiarano proprio questo ("Max. somma lati: cm 400").
  const sommaMax = Number(settings?.somma_lati_max) || 0
  if (sommaMax > 0 && arr.some((c: any) =>
    ((Number(c.length) || Number(c.lunghezza) || 0) + (Number(c.width) || Number(c.larghezza) || 0) + (Number(c.height) || Number(c.altezza) || 0)) > sommaMax
  )) return true
  // Misura combinata: lato maggiore + 2×(somma degli altri due lati)  (formula UPS = lunghezza+perimetro)
  const comb = Number(settings?.limite_combinato) || 0
  if (comb > 0 && arr.some((c: any) => {
    const d = [Number(c.length) || 0, Number(c.width) || 0, Number(c.height) || 0].sort((a, b) => b - a)
    return (d[0] + 2 * (d[1] + d[2])) > comb
  })) return true
  // Misure massime per-lato (con scaglioni di peso)
  const sc = settings?.misure_scaglioni
  const lim = (sc && sc.soglia_kg != null && sc.soglia_kg !== '')
    ? (pesoReale > Number(sc.soglia_kg) ? sc.sopra : sc.sotto)
    : settings?.misure_max
  const L = Number(lim?.lunghezza) || 0, W = Number(lim?.larghezza) || 0, H = Number(lim?.altezza) || 0
  if (L > 0 && W > 0 && H > 0) {
    const limits = [L, W, H].sort((a, b) => b - a)
    if (arr.some((c: any) => {
      const dims = [Number(c.length) || 0, Number(c.width) || 0, Number(c.height) || 0].sort((a, b) => b - a)
      return dims[0] > limits[0] || dims[1] > limits[1] || dims[2] > limits[2]
    })) return true
  }
  return false
}

// Spiega A PAROLE quale limite e' stato superato, per dire all'utente cosa correggere invece di un
// generico "corriere non disponibile". Restituisce null se nessun limite e' superato.
export function motivoLimiteCollo(settings: any, pesoReale: number, colli: any[]): string | null {
  const arr = colli || []
  const colliMax = Number(settings?.colli_max) || 0
  if (colliMax > 0 && arr.length > colliMax) return `questo contratto accetta al massimo ${colliMax} colli per spedizione`
  const pesoMaxCollo = Number(settings?.peso_max_collo) || 0
  if (pesoMaxCollo > 0 && arr.some((c: any) => (Number(c.weight) || Number(c.peso) || 0) > pesoMaxCollo)) return `il peso massimo per collo di questo contratto è ${pesoMaxCollo} kg`
  const sommaMax = Number(settings?.somma_lati_max) || 0
  if (sommaMax > 0 && arr.some((c: any) =>
    ((Number(c.length) || 0) + (Number(c.width) || 0) + (Number(c.height) || 0)) > sommaMax
  )) return `la somma dei tre lati di un collo non può superare ${sommaMax} cm`
  if (superaLimitiCollo(settings, pesoReale, arr)) return 'le misure del collo superano i limiti di questo contratto'
  return null
}

// SUPPLEMENTO FUORI SAGOMA (avviso, NON blocco, NON addebito): se il contratto ha la regola
// `settings.supplemento_fuori_sagoma` e un collo la supera, torna il testo dell'avviso da mostrare in
// creazione. Il supplemento NON si addebita qui: sui contratti GLS il €10 lo fattura il corriere e
// rientra post-fattura (file ripesature) — addebitarlo anche adesso sarebbe un doppio addebito. Questo
// è solo un cartello: "occhio, GLS ti metterà il fuori sagoma". Regola GLS: collo singolo con peso
// REALE oltre la soglia (70 kg) o LATO PIÙ LUNGO oltre la soglia (150 cm). La variante pallet (base
// oltre 120×80 E lato >150) è un sottoinsieme del lato>150, quindi per l'avviso basta questo controllo.
export function avvisoFuoriSagoma(settings: any, colli: any[]): string | null {
  const fs = settings?.supplemento_fuori_sagoma
  if (!fs || fs.attivo === false) return null
  const pesoMax = Number(fs.collo_peso_max_reale_kg) || 0
  const latoMax = Number(fs.collo_lato_max_cm) || 0
  if (!(pesoMax > 0) && !(latoMax > 0)) return null
  const importo = Number(fs.importo) || 0
  const superato = (colli || []).some((c: any) => {
    const peso = Number(c.weight) || Number(c.peso) || 0
    const lati = [Number(c.length) || Number(c.lunghezza) || 0, Number(c.width) || Number(c.larghezza) || 0, Number(c.height) || Number(c.altezza) || 0]
    const latoMaggiore = Math.max(...lati)
    return (pesoMax > 0 && peso > pesoMax) || (latoMax > 0 && latoMaggiore > latoMax)
  })
  if (!superato) return null
  const soglie = [pesoMax > 0 ? `${pesoMax} kg reali` : '', latoMax > 0 ? `${latoMax} cm sul lato più lungo` : ''].filter(Boolean).join(' o ')
  return `Fuori sagoma: un collo supera ${soglie} → il corriere applicherà un supplemento${importo > 0 ? ` di € ${importo}${fs.iva ? ' + IVA' : ''}` : ''}, che ti sarà addebitato in fattura.`
}
