// CHI E' IL MIO FIGLIO DIRETTO PER QUESTA SPEDIZIONE.
//
// Una spedizione di un master che sta cinque livelli sotto di me non si consegna a lui: si consegna
// a chi ho sotto IO — il figlio di prima linea attraverso cui quel ramo discende. Vale per i resi,
// per le distinte, per i contrassegni e per l'elenco spedizioni: in tutti e quattro il denaro e la
// carta passano di mano un gradino alla volta, mai saltando.
//
// La stessa camminata era riscritta a mano in sei rotte. Finche' era copiata, "chi e' il figlio
// diretto" poteva rispondere in modo diverso a seconda della porta da cui si entrava — ed e' una
// domanda che decide a chi arrivano dei soldi.
//
// Torna una mappa: id di un discendente qualsiasi -> id del MIO figlio diretto sopra di lui.

export async function mappaPrimaLinea(admin: any, mio: string, profondita = 12): Promise<Map<string, string>> {
  const primaLinea = new Map<string, string>()
  let frontiera = [mio]
  for (let i = 0; i < profondita && frontiera.length; i++) {
    const { data: figli } = await admin.from('masters').select('id,parent_master_id').in('parent_master_id', frontiera)
    const nuovi: string[] = []
    for (const c of (figli || [])) {
      // Un master gia' visto (o me stesso) chiuderebbe un anello e farebbe girare a vuoto la
      // camminata: si salta, la prima risposta e' quella buona.
      if (primaLinea.has(c.id) || c.id === mio) continue
      primaLinea.set(c.id, c.parent_master_id === mio ? c.id : (primaLinea.get(c.parent_master_id) || c.id))
      nuovi.push(c.id)
    }
    frontiera = nuovi
  }
  return primaLinea
}
