// La grafica nuova sul server, comune al portale master e al portale cliente (19/11): il carattere e la luce con cui la
// pagina nasce. Una regola sola per i due layout.
import { Outfit } from 'next/font/google'

// Il carattere della grafica nuova (v11). preload: false: con la grafica di oggi la pagina non lo scarica nemmeno.
export const outfit = Outfit({ subsets: ['latin'], variable: '--font-outfit', display: 'swap', preload: false })
function luceNotte(scelta: string): boolean {
  if (scelta === 'notte') return true
  if (scelta !== 'auto') return false
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Rome', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date()).map(x => [x.type, x.value]))
  const m = Number(p.hour) * 60 + Number(p.minute)
  return m < 7 * 60 || m >= 18 * 60 + 12
}
// La luce con cui la pagina nasce, decisa QUI sul server: la scelta di chi guarda (biscotto mx_tema: auto, giorno o
// notte) e, in Auto, il chiaro/scuro del dispositivo (biscotto mx_scuro, qui sotto); l'ora di Roma solo se manca. Così la pagina arriva già col vetro giusto, senza uno script che la ritocchi prima
// del disegno (React non lo accetta, e il server e il browser disegnerebbero due pagine diverse).
//
// «Auto» segue il chiaro/scuro del dispositivo (Lorenzo 21/11: nell'app «ovvio quella del telefono che è automatica,
// chiaro o scuro», e sì anche per il sito). Il server non vede prefers-color-scheme (Safari e la WebView di iOS non
// mandano nemmeno il client hint): lo legge dal biscotto mx_scuro (1 scuro, 0 chiaro), che scrivono la pagina
// (CorniceNuova, a ogni apertura e a ogni cambio del dispositivo) e il guscio dell'app. Senza biscotto, alla prima
// visita, vale l'ora di Roma e la pagina si corregge appena parte.
export function luceIniziale(scelta: string, dispositivo?: { scuro?: string }): string {
  if (scelta === 'auto' && (dispositivo?.scuro === '1' || dispositivo?.scuro === '0')) return dispositivo.scuro === '1' ? 'notte' : 'argilla'
  // 27/10: il giorno è il plastico bianco («argilla», dai riferimenti RoutaX di Lorenzo); la notte resta la notte
  return luceNotte(scelta) ? 'notte' : 'argilla'
}


// la scelta di chi guarda, dal biscotto mx_tema (auto se manca o non è valido)
export function sceltaTema(v?: string): string { return ['auto', 'giorno', 'notte'].includes(v || '') ? v! : 'auto' }
