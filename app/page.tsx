export default function Home() {
  return (
    <div style={{display:'flex',alignItems:'center',justifyContent:'center',minHeight:'100vh',background:'#f5f5f5',fontFamily:'system-ui,sans-serif'}}>
      <div style={{background:'#fff',borderRadius:'12px',padding:'40px',width:'380px',boxShadow:'0 2px 16px rgba(0,0,0,.08)'}}>
        <div style={{textAlign:'center',marginBottom:'32px'}}>
          <div style={{fontSize:'22px',fontWeight:'800',color:'#1a1a1a'}}>Spedix<span style={{color:'#f97316'}}>Pro</span></div>
          <div style={{fontSize:'13px',color:'#999',marginTop:'4px'}}>Control Center</div>
        </div>
        <form action="/api/auth/login" method="POST" style={{display:'flex',flexDirection:'column',gap:'14px'}}>
          <div>
            <label style={{fontSize:'11.5px',fontWeight:'600',color:'#666',display:'block',marginBottom:'4px'}}>Email</label>
            <input name="email" type="email" required placeholder="admin@ecomize.it"
              style={{width:'100%',padding:'9px 12px',border:'1px solid #e8e8e8',borderRadius:'6px',fontSize:'13px',color:'#1a1a1a',boxSizing:'border-box'}}/>
          </div>
          <div>
            <label style={{fontSize:'11.5px',fontWeight:'600',color:'#666',display:'block',marginBottom:'4px'}}>Password</label>
            <input name="password" type="password" required placeholder="••••••••"
              style={{width:'100%',padding:'9px 12px',border:'1px solid #e8e8e8',borderRadius:'6px',fontSize:'13px',color:'#1a1a1a',boxSizing:'border-box'}}/>
          </div>
          <button type="submit"
            style={{background:'#f97316',color:'#fff',border:'none',padding:'11px',borderRadius:'6px',fontSize:'14px',fontWeight:'700',cursor:'pointer'}}>
            Accedi
          </button>
        </form>
      </div>
    </div>
  )
}
