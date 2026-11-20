/* I CONTRASSEGNI DEI RESI SI FERMANO A MULTIEXPRESS E A LOGIXIA (decisioni di Lorenzo, 06/11 e 20/11/2026).
 *
 * Un pacco tornato al mittente il contrassegno non l'ha incassato dal destinatario, ma il corriere può
 * averlo messo lo stesso nel suo file, e chi sta sopra lo carica: il 06/11 la Lista Contrassegni SDA di
 * LOGIXIA ne aveva 21 (1.354,78 €) fra 711. Lorenzo, 06/11: «falle passare e poi fermale lì da MULTIEXPRESS,
 * dicendo 21 sono resi, e poi lui decide se propagare o tenerseli». Nella sosta di chi ferma i resi questi
 * non stanno nei gruppi da caricare ma in un riquadro a parte, non scendono con "Seleziona tutti", e
 * scendono solo se il master li sceglie uno per uno. Tenerli vuol dire lasciarli lì: nessuna distinta,
 * nessun movimento. Vale per ogni contratto.
 *
 * 20/11: SDA quei 21 resi a LOGIXIA non li aveva pagati, ma LOGIXIA li aveva gia' fatti scendere a Wave
 * (e da li' a MULTI, uno fino al cliente). Lorenzo: «metti il blocco contrassegni che ha MULTI anche su
 * LOGIXIA, cosi' LOGIXIA non li propaga piu'». LOGIXIA e' il detentore di SDA EXPRESS L: fermarli li'
 * vuol dire fermarli al primo livello, prima di qualunque pagamento lungo la catena.
 *
 * Reso = lo stato della spedizione che sta in sosta (la gamba originante) è 'reso_mittente'. */
export const MASTER_CHE_FERMANO_I_RESI = new Set<string>([
  'a8d42a25-3711-4343-a6df-ee2ba9bbf08b',   // MULTIEXPRESS
  '650aa6d5-7b84-495e-a0bf-1e8d46666802',   // LOGIXIA SRLS
])

export const fermaIResi = (masterId: string | null | undefined) => !!masterId && MASTER_CHE_FERMANO_I_RESI.has(masterId)

// Fra le spedizioni date, quelle tornate al mittente.
export async function spedizioniRese(admin: any, ids: string[]): Promise<Set<string>> {
  const rese = new Set<string>()
  const unici = Array.from(new Set(ids.filter(Boolean)))
  for (let i = 0; i < unici.length; i += 300) {
    const { data, error } = await admin.from('spedizioni').select('id')
      .in('id', unici.slice(i, i + 300)).eq('stato', 'reso_mittente')
    // Se la lettura non riesce non si sa chi e' reso: meglio fermarsi che farli scendere tutti.
    if (error) throw new Error('stato dei resi non leggibile: ' + error.message)
    for (const s of (data || [])) rese.add((s as any).id)
  }
  return rese
}
