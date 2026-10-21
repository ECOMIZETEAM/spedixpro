'use client'
import { useState, useEffect } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import ClienteNav from './ClienteNav'
import Moovy from '../components/Moovy'
import TutorialCliente from './TutorialCliente'
import MenuProfilo from '../components/MenuProfilo'
import CampanellaNotifiche from '../components/CampanellaNotifiche'
import SupportoButton from '../components/SupportoButton'
import CompletaDatiNegozio, { EVENTO_APRI_DATI_NEGOZIO } from './CompletaDatiNegozio'
import type { DatiSchermataNegozio } from '@/lib/dati-negozio'

export default function ClienteShell({ cliente, children, brandLogo, brandNome, completaDati = null, versioneDati = null, contattoAiuto = null, soloEtichette = false }: {
  cliente: { ragione_sociale?: string | null; credito?: number | null }; children: React.ReactNode; brandLogo?: string | null; brandNome?: string | null
  // Dal layout, calcolati sul server (lib/dati-negozio, lib/conti-shopify): null / false per tutti i
  // clienti che non sono un negozio Shopify appena installato.
  completaDati?: DatiSchermataNegozio | null; versioneDati?: string | null; contattoAiuto?: string | null; soloEtichette?: boolean
}) {
  const path = usePathname() || ''
  const router = useRouter()
  const [isMobile, setIsMobile] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  // Desktop: sidebar richiudibile (preferenza ricordata per sessioni future)
  const [sidebarChiusa, setSidebarChiusa] = useState(false)
  useEffect(() => { try { if (localStorage.getItem('spx_sidebar_chiusa') === '1') setSidebarChiusa(true) } catch {} }, [])
  const toggleSidebar = () => setSidebarChiusa(v => { const n = !v; try { localStorage.setItem('spx_sidebar_chiusa', n ? '1' : '0') } catch {}; return n })
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 900)
    check(); window.addEventListener('resize', check); return () => window.removeEventListener('resize', check)
  }, [])
  useEffect(() => { setDrawerOpen(false) }, [path])
  // La voce "Introduzione" del menu apre il tutorial: su mobile il drawer va chiuso
  // per non restare aperto sotto (e sopra) l'overlay.
  useEffect(() => {
    const chiudi = () => setDrawerOpen(false)
    window.addEventListener('moovx-apri-tutorial', chiudi)
    return () => window.removeEventListener('moovx-apri-tutorial', chiudi)
  }, [])

  // LA SCHERMATA DEI DATI DEL NEGOZIO (primo accesso dei conti nati da Shopify).
  // Se mostrarla lo decide il layout sul server; qui si ricorda solo che e' stata chiusa da un
  // salvataggio, finche' il layout ricaricato non dice la sua. Il ricordo e' legato ai dati per cui e'
  // stata chiusa: se il layout la richiede con dati diversi (salvataggio respinto perche' qualcuno li ha
  // cambiati nel frattempo) si riapre con quelli nuovi.
  // Il layout non si riesegue nelle navigazioni interne: per questo dopo il salvataggio, e quando una
  // pagina chiede di riaprirla, si fa router.refresh(), che lo rifa' girare senza perdere lo stato.
  // L'impronta dei dati (versioneDati) resta fuori dalla firma: se cambia senza che cambi niente a
  // schermo la schermata non deve ripartire da capo, e quello che il negoziante ha scritto resta.
  const firmaDati = completaDati ? JSON.stringify(completaDati) : ''
  const [chiusaPer, setChiusaPer] = useState<string | null>(null)
  const schermataAperta = !!completaDati && chiusaPer !== firmaDati
  // Il perche' di un salvataggio respinto (i dati sono cambiati mentre si compilava) sta qui e non nella
  // schermata: se i dati a schermo cambiano la schermata riparte da capo, e col suo stato se ne andava
  // anche la spiegazione. Il negoziante si trovava davanti campi diversi da quelli scritti, senza sapere
  // perche'.
  const [avvisoDati, setAvvisoDati] = useState('')
  useEffect(() => {
    const riapri = () => { setChiusaPer(null); setAvvisoDati(''); router.refresh() }
    window.addEventListener(EVENTO_APRI_DATI_NEGOZIO, riapri)
    return () => window.removeEventListener(EVENTO_APRI_DATI_NEGOZIO, riapri)
  }, [router])

  // overflow: hidden → scorre solo il <nav> di ClienteNav; brand/utente/Esci restano fissi
  const asideBase: React.CSSProperties = { width: '200px', background: '#1a1a1a', display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden', zIndex: 1000 }
  const asideStyle: React.CSSProperties = isMobile
    ? { ...asideBase, position: 'fixed', top: 0, left: 0, transform: drawerOpen ? 'translateX(0)' : 'translateX(-100%)', transition: 'transform 0.25s ease', boxShadow: drawerOpen ? '2px 0 20px rgba(0,0,0,0.35)' : 'none' }
    : { ...asideBase, flexShrink: 0, position: 'sticky', top: 0, width: sidebarChiusa ? '0px' : '200px', transition: 'width 0.2s ease' }

  const nome = cliente?.ragione_sociale || 'Cliente'
  const credito = Number(cliente?.credito || 0)

  return (
    <div style={{ display: 'flex', ...(isMobile ? { minHeight: '100vh' } : { height: '100vh', overflow: 'hidden' }), background: '#f5f5f5', fontFamily: 'var(--font-geist-sans),system-ui,sans-serif' }}>
      {isMobile && drawerOpen && <div onClick={() => setDrawerOpen(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 999 }} />}

      <aside style={asideStyle}>
        <a href="/cliente/dashboard" style={{ padding: '18px', borderBottom: '1px solid #2a2a2a', display: 'block', textDecoration: 'none', flexShrink: 0 }}>
          {brandLogo ? (
            <img src={brandLogo} alt={brandNome || 'Logo'} style={{ maxHeight: '34px', maxWidth: '150px', objectFit: 'contain', display: 'block' }} />
          ) : brandNome ? (
            <div style={{ fontSize: '16px', fontWeight: '800', color: '#fff' }}>{brandNome}</div>
          ) : (
            <div style={{ fontSize: '16px', fontWeight: '800', color: '#fff' }}>Moov<span style={{ color: '#f97316' }}>Express</span></div>
          )}
          <div style={{ fontSize: '9px', color: '#fff', marginTop: '2px', textTransform: 'uppercase', letterSpacing: '1px' }}>Portale Cliente</div>
        </a>
        <div style={{ padding: '8px 0', borderBottom: '1px solid #2a2a2a', flexShrink: 0 }}>
          <div style={{ padding: '8px 16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div style={{ width: '28px', height: '28px', background: '#f97316', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', fontWeight: '700', color: '#fff', flexShrink: 0 }}>
              {nome.substring(0, 2).toUpperCase()}
            </div>
            <div>
              <div style={{ fontSize: '11.5px', fontWeight: '600', color: '#e5e5e5', lineHeight: 1 }}>{nome}</div>
              <div style={{ fontSize: '10px', color: '#f97316', marginTop: '2px' }}>€ {credito.toFixed(2)}</div>
            </div>
          </div>
        </div>

        <ClienteNav soloEtichette={soloEtichette} />

        <div style={{ borderTop: '1px solid #2a2a2a', padding: '6px 0', flexShrink: 0 }}>
          <a href="/api/auth/logout" style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '7px 16px', color: '#555', fontSize: '12.5px', textDecoration: 'none' }}>
            <span style={{ fontSize: '11px' }}>→</span> Esci
          </a>
        </div>
      </aside>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0 }}>
        <header style={{ background: '#fff', height: '48px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: isMobile ? '0 12px' : '0 24px', borderBottom: '1px solid #e8e8e8', position: 'sticky', top: 0, zIndex: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
            <button onClick={() => { if (isMobile) setDrawerOpen(true); else toggleSidebar() }} aria-label="Menu" title={isMobile?'Menu':(sidebarChiusa?'Apri il menu':'Chiudi il menu')} style={{ background: 'none', border: 'none', fontSize: '23px', cursor: 'pointer', color: '#1a1a1a', padding: '2px 6px', lineHeight: 1 }}>☰</button>
            {!isMobile && <div style={{ fontSize: '13px', color: '#999', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{nome}</div>}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? '6px' : '8px' }}>
            <span style={{ background: '#f5f5f5', border: '1px solid #e8e8e8', borderRadius: '20px', padding: '4px 12px', fontSize: '12px', fontWeight: '600', color: '#1a1a1a', whiteSpace: 'nowrap' }}>
              Credito: <span style={{ color: credito > 0 ? '#16a34a' : '#dc2626' }}>€ {credito.toFixed(2)}</span>
            </span>
            <SupportoButton compatto={isMobile} />
            <CampanellaNotifiche />
            <MenuProfilo nome={nome} ruolo="cliente" compatto={isMobile} voci={[
              { label: 'Impostazioni', href: '/cliente/impostazioni', icona: '◉' },
              { label: 'Ricarica credito', href: '/cliente/ricarica', icona: '★' },
              { label: 'Cambia password', href: '/cliente/impostazioni/cambia-password', icona: '🔑' },
            ]} />
          </div>
        </header>
        <main style={{ flex: 1, minHeight: 0, padding: isMobile ? '14px' : '24px', overflowY: 'auto' }}>
          {children}
        </main>
      </div>
      <Moovy />
      {/* Il tutorial aspetta che i dati del negozio siano salvati: prima i dati, poi la visita guidata. */}
      <TutorialCliente brandNome={brandNome} sospeso={schermataAperta} />
      {schermataAperta && completaDati && (
        <CompletaDatiNegozio key={firmaDati} dati={completaDati} versione={versioneDati} contatto={contattoAiuto}
          avviso={avvisoDati} brandLogo={brandLogo} brandNome={brandNome}
          onCambiati={setAvvisoDati}
          onFatto={() => { setAvvisoDati(''); setChiusaPer(firmaDati); router.refresh() }} />
      )}
    </div>
  )
}
