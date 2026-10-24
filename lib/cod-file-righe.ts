/* LE RIGHE DI UN FILE CONTRASSEGNI XLS/XLSX, come le legge Distinte Contrassegni prima di mandarle a
 * /api/contrassegni/upload-cod. Sta qui e non nella pagina perché la prova sui file veri deve leggere
 * il file esattamente come lo legge il portale.
 *
 * Di norma: primo foglio, intestazione nella prima riga (export SpediamoPro, file Ecomize/E&A, file a
 * mano "ldv / ImportoCod").
 *
 * La "Distinta Contrassegni" di SDA (la carica LOGIXIA per SDA EXPRESS L, primo file il 22/10/2026) no:
 * sopra l'intestazione ci sono titolo, cliente e data distinta, e i titoli delle colonne stanno alla
 * sesta riga ("Nr. LdV", "Incasso COR (€)", "Rimborso SDA il"…); in fondo c'è la riga "TOTALE GENERALE"
 * e un secondo foglio di riepilogo per mittente. Letta come gli altri, ogni riga arrivava senza LDV:
 * 466 contrassegni da 34.900,95 € tutti scartati. Si cerca la cella "Nr. LdV" nelle prime righe di ogni
 * foglio: se c'è, si legge da lì, si tengono le sole righe con una LDV e le sole colonne che servono
 * (destinatario e mittente non servono al caricamento). Se non c'è, tutto come prima. */
const norm = (v: any) => String(v ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')
const COLONNE_SDA = new Set(['nrldv', 'incassocor', 'rimborsosdail'])

export function righeFileCod(utils: any, wb: any): any[] {
  let righeSda: any[] | null = null
  for (const nome of wb.SheetNames) {
    const foglio = wb.Sheets[nome]
    if (!foglio?.['!ref']) continue
    const area = utils.decode_range(foglio['!ref'])
    let rigaIntestazione = -1
    for (let r = area.s.r; r <= Math.min(area.e.r, area.s.r + 30) && rigaIntestazione < 0; r++) {
      for (let c = area.s.c; c <= area.e.c; c++) {
        const cella = foglio[utils.encode_cell({ r, c })]
        if (cella && norm(cella.w ?? cella.v) === 'nrldv') { rigaIntestazione = r; break }
      }
    }
    if (rigaIntestazione < 0) continue
    // Numeri come numeri (raw di default), come gli altri file di questa pagina: l'importo nel foglio è
    // una cella numerica, e il testo formattato ("1,581.90") la rotta lo leggerebbe come 1,58.
    const lette = utils.sheet_to_json(foglio, { range: rigaIntestazione, defval: '' }) as any[]
    const ridotte = lette.map(riga => {
      const o: any = {}
      for (const k of Object.keys(riga)) if (COLONNE_SDA.has(norm(k))) o[k] = riga[k]
      return o
    }).filter(o => Object.keys(o).some(k => norm(k) === 'nrldv' && String(o[k]).trim()))
    righeSda = [...(righeSda || []), ...ridotte]
  }
  return righeSda ?? utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]])
}
