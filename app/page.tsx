export default function Home() {
  return (
    <div style={{display:'flex',alignItems:'center',justifyContent:'center',height:'100vh',background:'#0f1623'}}>
      <div style={{background:'#1a2235',padding:'40px',borderRadius:'14px',width:'380px',boxShadow:'0 20px 60px rgba(0,0,0,.4)'}}>
        <div style={{textAlign:'center',marginBottom:'32px'}}>
          <div style={{fontSize:'32px',marginBottom:'8px'}}>📦</div>
          <h1 style={{color:'#fff',fontSize:'22px',fontWeight:'800',margin:'0'}}>Spedix<span style={{color:'#60a5fa'}}>Pro</span></h1>
          <p style={{color:'#475569',fontSize:'13px',marginTop:'4px'}}>Control Center</p>
        </div>
        <form action="/api/auth/login" method="POST">
          <div style={{marginBottom:'16px'}}>
            <label style={{color:'#94a3b8',fontSize:'12px',fontWeight:'600',textTransform:'uppercase',letterSpacing:'0.5px'}}>Email</label>
            <input name="email" type="email" required style={{width:'100%',marginTop:'6px',padding:'10px 12px',background:'#0f1623',border:'1px solid #334155',borderRadius:'8px',color:'#fff',fontSize:'14px',outline:'none',boxSizing:'border-box'}} placeholder="admin@ecomize.it"/>
          </div>
          <div style={{marginBottom:'24px'}}>
            <label style={{color:'#94a3b8',fontSize:'12px',fontWeight:'600',textTransform:'uppercase',letterSpacing:'0.5px'}}>Password</label>
            <input name="password" type="password" required style={{width:'100%',marginTop:'6px',padding:'10px 12px',background:'#0f1623',border:'1px solid #334155',borderRadius:'8px',color:'#fff',fontSize:'14px',outline:'none',boxSizing:'border-box'}} placeholder="••••••••"/>
          </div>
          <button type="submit" style={{width:'100%',padding:'11px',background:'#2563eb',color:'#fff',border:'none',borderRadius:'8px',fontSize:'14px',fontWeight:'700',cursor:'pointer'}}>Accedi</button>
        </form>
      </div>
    </div>
  )
}
