import CambioPassword from '@/app/components/CambioPassword'
import { SezioneVerifica } from '@/app/components/VerificaDuePassaggi'

export default function CambiaPasswordPage() {
  return (
    <div>
      <h1 style={{ fontSize: '20px', fontWeight: 700, color: '#1a1a1a', margin: '0 0 16px' }}>Cambia Password</h1>
      <CambioPassword />
      <SezioneVerifica />
    </div>
  )
}
