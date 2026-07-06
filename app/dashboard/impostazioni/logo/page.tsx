'use client'
import { useState, useEffect } from 'react'

const lbl = {fontSize:'12px',fontWeight:'600' as const,color:'#1a1a1a',display:'block' as const,marginBottom:'4px'}

export default function LogoPage() {
  const [logo, setLogo] = useState<string|null>(null)       // anteprima (dataURL locale o URL salvato)
  const [logoFile, setLogoFile] = useState<File|null>(null) // file scelto da caricare
  const [nome, setNome] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')

  useEffect(() => {
    fetch('/api/master').then(r => r.json()).then(d => {
      if (d && !d.error) { setNome(d.nome || ''); if (d.logo_url) setLogo(d.logo_url) }
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [])

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 2 * 1024 * 1024) { setMsg('Errore: il file supera i 2MB'); return }
    if (!file.type.startsWith('image/')) { setMsg('Errore: il logo deve essere un\'immagine'); return }
    // Ridimensiono a 300x90 mantenendo le proporzioni, centrato su sfondo trasparente
    const reader = new FileReader()
    reader.onload = (ev) => {
      const img = new Image()
      img.onload = () => {
        const W = 300, H = 90
        const canvas = document.createElement('canvas')
        canvas.width = W; canvas.height = H
        const ctx = canvas.getContext('2d')
        if (!ctx) { setMsg('Errore: impossibile elaborare l\'immagine'); return }
        ctx.clearRect(0, 0, W, H)
        const scala = Math.min(W / img.width, H / img.height)
        const nw = img.width * scala, nh = img.height * scala
        const ox = (W - nw) / 2, oy = (H - nh) / 2
        ctx.drawImage(img, ox, oy, nw, nh)
        canvas.toBlob((blob) => {
          if (!blob) { setMsg('Errore: elaborazione fallita'); return }
          const finale = new File([blob], 'logo.png', { type: 'image/png' })
          setLogoFile(finale)
          setLogo(canvas.toDataURL('image/png'))
        }, 'image/png')
      }
      img.src = ev.target?.result as string
    }
    reader.readAsDataURL(file)
  }

  async function salva() {
    setSaving(true); setMsg('')
    try {
      const fd = new FormData()
      if (logoFile) fd.append('file', logoFile)
      if (nome.trim()) fd.append('nome', nome.trim())
      const res = await fetch('/api/master/logo', { method: 'POST', body: fd })
      const data = await res.json()
      if (!res.ok) { setMsg('Errore: ' + (data.error || 'salvataggio fallito')) }
      else {
        setMsg('✅ Salvato con successo!')
        if (data.logo_url) { setLogo(data.logo_url); setLogoFile(null) }
        setTimeout(()=>setMsg(''), 3000)
      }
    } catch { setMsg('Errore di rete') }
    finally { setSaving(false) }
  }

  async function rimuovi() {
    setSaving(true); setMsg('')
    try {
      const res = await fetch('/api/master/logo', { method: 'DELETE' })
      const data = await res.json()
      if (!res.ok) setMsg('Errore: ' + (data.error || 'rimozione fallita'))
      else { setLogo(null); setLogoFile(null); setMsg('Logo rimosso.') ; setTimeout(()=>setMsg(''),3000) }
    } catch { setMsg('Errore di rete') }
    finally { setSaving(false) }
  }

  if (loading) return <div style={{padding:'40px',textAlign:'center',color:'#1a1a1a'}}>Caricamento...</div>

  return (
    <div>
      <div style={{marginBottom:'20px'}}>
        <h1 style={{fontSize:'20px',fontWeight:'700',color:'#1a1a1a',margin:0}}>🖼️ Logo e Nome Azienda</h1>
        <p style={{color:'#1a1a1a',fontSize:'13px',marginTop:'4px'}}>Il logo e il nome che vedrai tu e i tuoi clienti in alto a sinistra. Se non carichi un logo, viene mostrato il nome.</p>
      </div>
      <div style={{background:'#fff',borderRadius:'8px',border:'1px solid #d1d5db',padding:'24px'}}>

        <div style={{marginBottom:'20px',maxWidth:'420px'}}>
          <label style={lbl}>Nome visualizzato</label>
          <input value={nome} onChange={e=>setNome(e.target.value)} placeholder="Es. Franco Logistics"
            style={{width:'100%',padding:'9px 12px',border:'1px solid #d1d5db',borderRadius:'6px',fontSize:'13px',color:'#1a1a1a',background:'#fff',boxSizing:'border-box'}}/>
        </div>

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
                <button onClick={rimuovi} disabled={saving}
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
                  <div style={{fontSize:'11px',color:'#1a1a1a',marginTop:'8px'}}>{logoFile?.name || 'Logo attuale'}</div>
                </div>
              ) : (
                <div style={{textAlign:'center' as const,color:'#1a1a1a'}}>
                  <div style={{fontSize:'18px',fontWeight:'800',marginBottom:'4px'}}>{nome || 'MoovExpress'}</div>
                  <div style={{fontSize:'12px'}}>Nessun logo — verrà mostrato il nome</div>
                </div>
              )}
            </div>
          </div>
        </div>

        {msg && (
          <div style={{background:msg.startsWith('✅')?'#f0fdf4':(msg.startsWith('Errore')?'#fef2f2':'#f9fafb'),border:`1px solid ${msg.startsWith('✅')?'#bbf7d0':(msg.startsWith('Errore')?'#fecaca':'#e5e7eb')}`,borderRadius:'6px',padding:'10px 14px',marginTop:'16px',fontSize:'13px',color:msg.startsWith('✅')?'#16a34a':(msg.startsWith('Errore')?'#dc2626':'#1a1a1a')}}>
            {msg}
          </div>
        )}

        <div style={{marginTop:'20px'}}>
          <button onClick={salva} disabled={saving}
            style={{padding:'9px 24px',background:'#f97316',color:'#fff',border:'none',borderRadius:'6px',fontSize:'13px',fontWeight:'700',cursor:saving?'not-allowed':'pointer',opacity:saving?0.7:1}}>
            {saving ? 'Salvataggio...' : '💾 Salva'}
          </button>
        </div>
      </div>
    </div>
  )
}
