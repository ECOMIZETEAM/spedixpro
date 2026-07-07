import GiacenzaDettaglio from '@/app/components/GiacenzaDettaglio'
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <GiacenzaDettaglio id={id} tornaHref="/cliente/spedizioni/giacenze" />
}
