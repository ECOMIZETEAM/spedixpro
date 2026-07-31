// AGEVOLAZIONE PESO REALE: quando un collo è abbastanza piccolo, il corriere lo tassa sul peso
// REALE invece che su quello volumetrico.
//
// La scatola entro cui vale l'agevolazione era scritta a mano in QUATTRO punti diversi come
// 50×32×28 cm. Ma è una condizione del CONTRATTO, non una legge di natura: i contratti DVA, per
// esempio, la danno entro 50×28×30. Con la misura fissa nel codice un collo 50×32×28 verrebbe
// tassato da noi sul peso reale e dal corriere sul volumetrico — cioè lo venderemmo meno di quanto
// ci costa, in silenzio.
//
// Ora la scatola si legge dal contratto (`settings.agevolazione_misure`) e resta 50×32×28 solo
// come valore di ripiego per i contratti che non la dichiarano, così nulla cambia dove non è stata
// configurata.

const PREDEFINITA = { lunghezza: 50, larghezza: 32, altezza: 28 }

// Vero se OGNI collo sta dentro la scatola del contratto. I lati si confrontano ORDINATI dal più
// lungo al più corto: un collo si può girare, quindi conta la sagoma, non l'ordine dei campi.
// Un collo senza misure non fa decadere l'agevolazione (non c'è volumetrico da calcolare).
export function entroMisureAgevolate(settings: any, colli: any[]): boolean {
  const box = settings?.agevolazione_misure || PREDEFINITA
  const lim = [Number(box.lunghezza) || 0, Number(box.larghezza) || 0, Number(box.altezza) || 0]
    .filter(n => n > 0).sort((a, b) => b - a)
  if (lim.length < 3) return false
  return (colli || []).every((p: any) => {
    const L = Number(p?.length ?? p?.lunghezza) || 0
    const W = Number(p?.width ?? p?.larghezza) || 0
    const H = Number(p?.height ?? p?.altezza) || 0
    if (!L && !W && !H) return true
    const d = [L, W, H].sort((a, b) => b - a)
    return d[0] <= lim[0] && d[1] <= lim[1] && d[2] <= lim[2]
  })
}

// Descrizione a parole della scatola, per i messaggi e le schermate.
export function descriviAgevolazione(settings: any): string {
  const box = settings?.agevolazione_misure || PREDEFINITA
  return `${box.lunghezza}×${box.larghezza}×${box.altezza} cm`
}
