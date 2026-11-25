import Calendario from '@/app/components/calendario/Calendario'

// Il calendario del portale cliente: i suoi ritiri, le sue giacenze da gestire e i suoi promemoria (Lorenzo 25/11).
export default function PaginaCalendarioCliente() {
  return <Calendario portale="cliente" vedeRitiri vedeGiacenze />
}
