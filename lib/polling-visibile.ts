// IL GIRO DEI CONTATORI SI FERMA QUANDO NESSUNO LI GUARDA.
//
// Badge della sidebar, campanella, credito in alto, stato del piano: ogni scheda aperta del portale
// li richiedeva a tempo anche nascosta dietro le altre, o lasciata aperta la notte. Ogni giro e'
// una funzione su Vercel, una verifica della sessione e una lettura del profilo prima ancora del
// conteggio. Misurato su Vercel il 19-20/10/2026: di notte, con nessuno al lavoro, i badge del
// master giravano ancora ~380 volte l'ora; sull'intera giornata circa due schede master su tre erano
// nascoste (stima dai tre ritmi di 30 s, 60 s e 120 s degli stessi utenti, che il browser rallenta in
// modo diverso a scheda nascosta), e le schede cliente nascoste chiedevano lo stato del piano circa
// 57.000 volte al giorno.
//
// Il dato serve solo a chi lo guarda. A scheda nascosta il giro salta; al ritorno, se nel frattempo
// e' saltato almeno un giro, si ricarica SUBITO e il ritmo riparte da li'. Chi guarda vede quindi un
// numero vecchio al massimo quanto prima (mai piu' di un intervallo), chi non guarda non costa niente.
// La prima lettura, all'apertura, parte comunque, anche a scheda nascosta (link aperto in un'altra
// scheda): cosi' quando la si guarda per la prima volta il dato e' gia' li', come prima.
//
// Ritorna la funzione che smonta tutto: va restituita da useEffect.
export function pollaSeVisibile(carica: () => void, ogniMs: number): () => void {
  let ultimo = 0
  let timer: ReturnType<typeof setInterval> | undefined
  const esegui = () => { ultimo = Date.now(); carica() }
  const giro = () => { if (document.visibilityState === 'visible') esegui() }
  const arma = () => { if (timer) clearInterval(timer); timer = setInterval(giro, ogniMs) }
  const alRitorno = () => {
    if (document.visibilityState !== 'visible') return
    // Assente meno di un intervallo: nessun giro e' saltato, il prossimo arriva da solo.
    if (Date.now() - ultimo < ogniMs) return
    esegui()
    arma()
  }
  esegui()
  arma()
  document.addEventListener('visibilitychange', alRitorno)
  return () => {
    if (timer) clearInterval(timer)
    document.removeEventListener('visibilitychange', alRitorno)
  }
}
