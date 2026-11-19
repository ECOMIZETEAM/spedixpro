/* I CONTRASSEGNI DEI RESI SI FERMANO A MULTIEXPRESS (decisione di Lorenzo, 06/11/2026).
 *
 * Un pacco tornato al mittente il contrassegno non l'ha incassato dal destinatario, ma il corriere può
 * averlo messo lo stesso nel suo file, e chi sta sopra lo carica: il 06/11 la Lista Contrassegni SDA di
 * LOGIXIA ne aveva 21 (1.354,78 €) fra 711. Lorenzo: «falle passare e poi fermale lì da MULTIEXPRESS,
 * dicendo 21 sono resi, e poi lui decide se propagare o tenerseli». Quindi LOGIXIA e Wave caricano tutto
 * come sempre; nella sosta di MULTIEXPRESS i resi non stanno nei gruppi da caricare ma in un riquadro a
 * parte, non scendono con "Seleziona tutti", e scendono solo se MULTI li sceglie uno per uno. Tenerli
 * vuol dire lasciarli lì: nessuna distinta, nessun movimento. Vale per ogni contratto.
 *
 * Reso = lo stato della spedizione che sta in sosta (la gamba originante) è 'reso_mittente'. */
export const MASTER_CHE_FERMA_I_RESI = 'a8d42a25-3711-4343-a6df-ee2ba9bbf08b'   // MULTIEXPRESS

export const fermaIResi = (masterId: string | null | undefined) => masterId === MASTER_CHE_FERMA_I_RESI

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
