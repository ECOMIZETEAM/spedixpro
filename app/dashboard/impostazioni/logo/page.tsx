'use client'
import { useState } from 'react'

const lbl = {fontSize:'12px',fontWeight:'600' as const,color:'#1a1a1a',display:'block' as const,marginBottom:'4px'}

export default function LogoPage() {
  const [logo, setLogo] = useState<string|null>(null)
  const [logoFile, setLogoFile] = useState<File|null>(null)
  const [saved, setSaved] = useState(false)

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setLogoFile(file)
    const reader = new FileReader()
    reader.onload = (ev) => setLogo(ev.target?.result as string)
    reader.readAsDataURL(file)
  }

  function salva() { setSaved(true); setTimeout(()=>setSaved(false),3000) }

  return (
    <div>
      <div style={{marginBottom:'20px'}}>
        <h1 style={{fontSize:'20px',fontWeight:'700',color:'#1a1a1a',margin:0}}>🖼️ Logo Aziendale</h1>
        <p style={{color:'#1a1a1a',fontSize:'13px',marginTop:'4px'}}>Carica il logo della tua azienda. Verrà mostrato nelle etichette, nei report e nelle comunicazioni.</p>
      </div>
      <div style={{background:'#fff',borderRadius:'8px',border:'1px solid #d1d5db',padding:'24px'}}>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'24px'}}>
          <div>
            <label style={lbl}>Carica Logo (PNG, JPG, SVG — Max 2MB)</label>
            <div style={{border:'2px dashed #d1d5db',borderRadius:'8px',padding:'40px',textAlign:'center' as const,background:'#f9fafb',cursor:'pointer',marginTop:'4px'}}
              onClick={()=>document.getElementById('logoInput')?.click()}>
              {logo ? (
                <img src={logo} alt="Logo" style={{maxHeight:'120px',maxWidth:'100%',objectFit:'contain'}}/>
              ) : (
                <div>
                  <div style={{fontSize:'40px',marginBottom:'10px'}}>🖼️</div>
                  <div style={{fontSize:'13px',color:'#1a1a1a',marginBottom:'4px',fontWeight:'500'}}>Clicca per caricare il logo</div>
                  <div style={{fontSize:'11px',color:'#1a1a1a'}}>PNG 300x90px consigliato</div>
                </div>
              )}
            </div>
            <input id="logoInput" type="file" accept="image/*" onChange={handleChange} style={{display:'none'}}/>
            <div style={{display:'flex',gap:'8px',marginTop:'10px'}}>
              <button onClick={()=>document.getElementById('logoInput')?.click()}
                style={{padding:'6px 14px',background:'#f9fafb',border:'1px solid #d1d5db',borderRadius:'6px',fontSize:'12px',fontWeight:'600',cursor:'pointer',color:'#1a1a1a'}}>
                📁 Scegli file
              </button>
              {logo && (
                <button onClick={()=>{setLogo(null);setLogoFile(null)}}
                  style={{padding:'6px 14px',background:'#fef2f2',color:'#dc2626',border:'1px solid #fecaca',borderRadius:'6px',fontSize:'12px',fontWeight:'600',cursor:'pointer'}}>
                  🗑️ Rimuovi
                </button>
              )}
            </div>
          </div>
          <div>
            <label style={lbl}>Anteprima</label>
            <div style={{border:'1px solid #d1d5db',borderRadius:'8px',padding:'24px',background:'#f9fafb',minHeight:'160px',display:'flex',alignItems:'center',justifyContent:'center',marginTop:'4px'}}>
              {logo ? (
                <div style={{textAlign:'center' as const}}>
                  <img src={logo} alt="Anteprima" style={{maxHeight:'100px',maxWidth:'220px',objectFit:'contain'}}/>
                  <div style={{fontSize:'11px',color:'#1a1a1a',marginTop:'8px'}}>{logoFile?.name}</div>
                  <div style={{fontSize:'11px',color:'#1a1a1a'}}>{logoFile ? (logoFile.size/1024).toFixed(1) + ' KB' : ''}</div>
                </div>
              ) : (
                <div style={{textAlign:'center' as const,color:'#1a1a1a'}}>
                  <div style={{fontSize:'32px',marginBottom:'8px'}}>🏢</div>
                  <div style={{fontSize:'13px'}}>Nessun logo caricato</div>
                </div>
              )}
            </div>
          </div>
        </div>
        {saved && (
          <div style={{background:'#f0fdf4',border:'1px solid #bbf7d0',borderRadius:'6px',padding:'10px 14px',marginTop:'16px',fontSize:'13px',color:'#16a34a'}}>
            ✅ Logo salvato con successo!
          </div>
        )}
        <div style={{marginTop:'20px'}}>
          <button onClick={salva} disabled={!logo}
            style={{padding:'9px 24px',background:logo?'#f97316':'#e5e7eb',color:logo?'#fff':'#9ca3af',border:'none',borderRadius:'6px',fontSize:'13px',fontWeight:'700',cursor:logo?'pointer':'not-allowed'}}>
            💾 Salva Logo
          </button>
        </div>
      </div>
    </div>
  )
}