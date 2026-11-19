import { fetchAllStretto } from '@/lib/fetch-all'
import { giornoRoma } from '@/lib/date-roma'
import { senzaNomiFornitori } from '@/lib/corriere-logo'

const r2 = (n: number) => Math.round(n * 100) / 100

// I CONSUMABILI DEL CLIENTE = i servizi che ha comprato: materiale ('consumabile') e lavori di
// magazzino ('logistica': giacenza a scaffale, preparazione pacchi).
//
// Prima qui entravano anche rettifiche, giacenze e resi, comprese le correzioni a mano del credito
// (rettifiche senza spedizione: 1.135 movimenti di 431 clienti al 15/10/2026; un cliente il 20/08
// aveva -6.336.702 per un refuso compensato da ricariche che questo report non mostrava). Le
// rettifiche hanno il loro report; giacenze, resi e correzioni stanno nella Lista movimenti. La
// logistica invece mancava (15 movimenti).
//
// L'IMPORTO E' QUELLO ADDEBITATO, gia' comprensivo dell'IVA se il master l'ha messa: la spesa si
// registra come prezzo × quantita' × (1 + IVA/100) (app/api/consumabili, POST) e l'aliquota non resta
// scritta da nessuna parte. Il PDF scriveva "Iva (22%)" con accanto 0,00: un'IVA che non c'era.
// Non si puo' scorporare un'aliquota che non si conosce, quindi non si scrive nessuna aliquota.
export const ETICHETTA_TIPO: Record<string, string> = { consumabile: 'Consumabile', logistica: 'Logistica' }

export async function righeConsumabiliCliente(db: any, clienteId: string, f: { dal: string | null; al: string | null }) {
  const mov = await fetchAllStretto<any>(() => {
    let q = db.from('movimenti')
      .select('id,tipo,descrizione,importo,created_at')
      .eq('cliente_id', clienteId)
      .in('tipo', ['consumabile', 'logistica'])
    if (f.dal) q = q.gte('created_at', f.dal)
    if (f.al) q = q.lte('created_at', f.al)
    return q.order('created_at', { ascending: true }).order('id', { ascending: true })
  })
  return mov.map((m: any) => ({
    // Senza i nomi dei fornitori tecnici scritti a mano da alcuni master ("Addebito rettifiche
    // spedisci.online ..."): il documento va al cliente. Nel database restano come sono.
    descrizione: senzaNomiFornitori(m.descrizione),
    tipo: ETICHETTA_TIPO[m.tipo] || m.tipo,
    data: giornoRoma(new Date(m.created_at)),
    // Segno conservato: l'addebito (importo negativo) esce positivo, un ACCREDITO esce negativo e
    // abbassa il totale invece di gonfiarlo.
    importo: r2(-(Number(m.importo || 0))),
  }))
}
