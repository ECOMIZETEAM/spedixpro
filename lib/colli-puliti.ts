// IL PESO DI UN COLLO ARRIVA AL CORRIERE COME UN NUMERO PULITO.
// Dai negozi e dagli import il peso a volte nasce da una somma in virgola mobile e arriva come
// 16,599999999999994 kg. Il corriere lo legge così com'è e la somma dei colli scavalca la soglia
// della fascia: 3UW1WLJ118197 (Poste Business Express V, 23/11/2026, colli 16,8 + 16,6 +
// 16,599999999999994) DVA l'ha fatturata 15,48 € (fascia 70 kg) invece di 14,51 € (fascia 50 kg),
// e chi stava sotto pagava la fascia 50. Il peso si arrotonda ai grammi (3 decimali) prima di tutto:
// prezzo, controlli e preventivo del corriere leggono lo stesso numero.
export function colliConPesoPulito(colli: any[]): any[] {
  return (colli || []).map((c) => {
    const grezzo = c?.weight
    // Solo i numeri veri (o le stringhe con il punto): una stringa con la virgola resta com'era, così la
    // legge chi la leggeva già, senza cambiare nient'altro.
    if (typeof grezzo === 'string' && grezzo.includes(',')) return c
    const w = typeof grezzo === 'number' ? grezzo : parseFloat(String(grezzo ?? ''))
    if (!Number.isFinite(w)) return c
    const pulito = Math.round(w * 1000) / 1000
    // Sotto il grammo non si arrotonda a zero: un collo a peso 0 farebbe ripiegare altri calcoli su 1 kg.
    if (pulito === w || (pulito === 0 && w > 0)) return c
    return { ...c, weight: pulito }
  })
}
