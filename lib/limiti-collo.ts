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
