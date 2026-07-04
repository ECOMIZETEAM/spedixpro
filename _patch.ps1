$rel = "app\dashboard\reports\giacenze\page.tsx"
$fp = Join-Path (Get-Location) $rel
$c = [System.IO.File]::ReadAllText($fp)
$nl = "`r`n"
if ($c.Contains("reportsPaginate")) { Write-Host "GIA FATTO"; exit }
$err = @()

$a1 = "const [reports, setReports] = useState<any[]>([])"
if ($c.Contains($a1)) { $c = $c.Replace($a1, $a1 + $nl + "  const [perPage, setPerPage] = useState(10)" + $nl + "  const [pagina, setPagina] = useState(1)") } else { $err += "stato" }

$pos = $c.IndexOf("  return (")
if ($pos -ge 0) {
  $calc = "  const totalePagine = Math.max(1, Math.ceil(reports.length / perPage))" + $nl + "  const paginaCorr = Math.min(pagina, totalePagine)" + $nl + "  const reportsPaginate = reports.slice((paginaCorr - 1) * perPage, paginaCorr * perPage)" + $nl + $nl
  $c = $c.Substring(0, $pos) + $calc + $c.Substring($pos)
} else { $err += "return" }

$a3 = "<div style={{background:'#fff',borderRadius:'8px',border:'1px solid #d1d5db',overflow:'hidden'}}>" + $nl + "        <table style={{width:'100%',borderCollapse:'collapse' as const,fontSize:'13px'}}>"
if ($c.Contains($a3)) {
  $a3n = "<div style={{background:'#fff',borderRadius:'8px',border:'1px solid #d1d5db',overflow:'hidden'}}>" + $nl + "        <div style={{padding:'10px 16px',borderBottom:'1px solid #f0f0f0',fontSize:'12px',fontWeight:'400',color:'#666'}}>" + $nl + "          Mostra{' '}" + $nl + "          <select value={perPage} onChange={e=>{setPerPage(Number(e.target.value));setPagina(1)}}" + $nl + "            style={{padding:'3px 6px',border:'1px solid #d1d5db',borderRadius:'4px',fontSize:'12px',color:'#1a1a1a',background:'#fff'}}>" + $nl + "            <option value={10}>10</option><option value={25}>25</option><option value={50}>50</option><option value={100}>100</option>" + $nl + "          </select>{' '}elementi" + $nl + "        </div>" + $nl + "        <table style={{width:'100%',borderCollapse:'collapse' as const,fontSize:'13px'}}>"
  $c = $c.Replace($a3, $a3n)
} else { $err += "tabella" }

$a4 = ") : reports.map((r:any,i:number)=>("
if ($c.Contains($a4)) { $c = $c.Replace($a4, ") : reportsPaginate.map((r:any,i:number)=>(") } else { $err += "map" }
$c = $c.Replace("{reports.length - i}", "{reports.length - ((paginaCorr - 1) * perPage + i)}")
$c = $c.Replace("{reports.length-i}", "{reports.length - ((paginaCorr - 1) * perPage + i)}")

$cnt = ([regex]::Matches($c, [regex]::Escape("</table>"))).Count
if ($cnt -eq 1) {
  $pager = "</table>" + $nl + "        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'12px 16px',borderTop:'1px solid #e5e7eb',flexWrap:'wrap',gap:'8px'}}>" + $nl + "          <span style={{fontSize:'12px',color:'#666'}}>{reports.length===0?0:((paginaCorr-1)*perPage+1)}-{Math.min(paginaCorr*perPage,reports.length)} di {reports.length}</span>" + $nl + "          <div style={{display:'flex',alignItems:'center',gap:'4px'}}>" + $nl + "            <button onClick={()=>setPagina(p=>Math.max(1,p-1))} disabled={paginaCorr<=1} style={{padding:'5px 10px',border:'1px solid #d1d5db',borderRadius:'5px',background:'#fff',fontSize:'12px',cursor:paginaCorr<=1?'default':'pointer',color:paginaCorr<=1?'#ccc':'#1a1a1a'}}>Precedente</button>" + $nl + "            {Array.from({length: totalePagine}, (_,i)=>i+1).filter(n => n===1 || n===totalePagine || Math.abs(n-paginaCorr)<=2).map((n,idx,arr)=>(" + $nl + "              <span key={n} style={{display:'flex',alignItems:'center'}}>" + $nl + "                {idx>0 && arr[idx-1] !== n-1 && <span style={{padding:'0 4px',color:'#bbb',fontSize:'12px'}}>" + [char]0x2026 + "</span>}" + $nl + "                <button onClick={()=>setPagina(n)} style={{minWidth:'30px',padding:'5px 8px',border:'1px solid',borderColor:n===paginaCorr?'#f97316':'#d1d5db',borderRadius:'5px',background:n===paginaCorr?'#f97316':'#fff',color:n===paginaCorr?'#fff':'#1a1a1a',fontSize:'12px',fontWeight:n===paginaCorr?'700':'400',cursor:'pointer'}}>{n}</button>" + $nl + "              </span>" + $nl + "            ))}" + $nl + "            <button onClick={()=>setPagina(p=>Math.min(totalePagine,p+1))} disabled={paginaCorr>=totalePagine} style={{padding:'5px 10px',border:'1px solid #d1d5db',borderRadius:'5px',background:'#fff',fontSize:'12px',cursor:paginaCorr>=totalePagine?'default':'pointer',color:paginaCorr>=totalePagine?'#ccc':'#1a1a1a'}}>Successivo</button>" + $nl + "          </div>" + $nl + "        </div>"
  $c = $c.Replace("</table>", $pager)
} else { $err += "table$cnt" }

if ($err.Count -gt 0) { Write-Host ("ANNULLATO - ancore fallite: " + ($err -join ",")); exit }
Copy-Item $fp ($fp + ".bak_patch_" + (Get-Date -Format "yyyyMMdd_HHmmss"))
[System.IO.File]::WriteAllText($fp, $c, [System.Text.UTF8Encoding]::new($false))
$v = [System.IO.File]::ReadAllText($fp)
$o=([regex]::Matches($v,"\{")).Count;$cl=([regex]::Matches($v,"\}")).Count
Write-Host ("SALVATO | reportsPaginate:" + $v.Contains('reportsPaginate') + " | Mostra:" + $v.Contains("Mostra{' '}") + " | graffe:$o/$cl")