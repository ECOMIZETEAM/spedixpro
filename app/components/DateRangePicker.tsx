'use client'
import { useState, useRef, useEffect } from 'react'

type Props = { dal: string, al: string, onChange: (dal: string, al: string) => void }

const MESI = ['Gennaio','Febbraio','Marzo','Aprile','Maggio','Giugno','Luglio','Agosto','Settembre','Ottobre','Novembre','Dicembre']
const GIORNI = ['Lu','Ma','Me','Gi','Ve','Sa','Do']

function toStr(d: Date) {
  const y = d.getFullYear(), m = String(d.getMonth()+1).padStart(2,'0'), g = String(d.getDate()).padStart(2,'0')
  return y+'-'+m+'-'+g
}
function fromStr(s: string): Date | null { return s ? new Date(s+'T00:00:00') : null }
function fmtIt(d: Date | null) {
  if (!d) return ''
  return String(d.getDate()).padStart(2,'0')+'/'+String(d.getMonth()+1).padStart(2,'0')+'/'+d.getFullYear()
}
function sameDay(a: Date | null, b: Date | null) {
  if (!a || !b) return false
  return a.getFullYear()===b.getFullYear() && a.getMonth()===b.getMonth() && a.getDate()===b.getDate()
}
function inRange(d: Date, s: Date | null, e: Date | null) {
  if (!s || !e) return false
  const t = d.getTime()
  return t > Math.min(s.getTime(),e.getTime()) && t < Math.max(s.getTime(),e.getTime())
}

export default function DateRangePicker({ dal, al, onChange }: Props) {
  const oggi = new Date()
  const [open, setOpen] = useState(false)
  const [start, setStart] = useState<Date | null>(fromStr(dal) || oggi)
  const [end, setEnd] = useState<Date | null>(fromStr(al) || oggi)
  const [meseSx, setMeseSx] = useState(new Date(oggi.getFullYear(), oggi.getMonth()-1, 1))
  const [meseDx, setMeseDx] = useState(new Date(oggi.getFullYear(), oggi.getMonth(), 1))
  const ref = useRef<HTMLDivElement>(null)

  // default: se non c'e' nulla, imposta oggi-oggi
  useEffect(() => {
    if (!dal && !al) { onChange(toStr(oggi), toStr(oggi)) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    function onClickFuori(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClickFuori)
    return () => document.removeEventListener('mousedown', onClickFuori)
  }, [])

  function clickGiorno(d: Date) {
    if (!start || (start && end)) { setStart(d); setEnd(null) }
    else {
      if (d.getTime() < start.getTime()) { setEnd(start); setStart(d) }
      else setEnd(d)
    }
  }

  function applica() {
    const s = start || oggi
    const e = end || start || oggi
    const a = s.getTime() <= e.getTime() ? s : e
    const b = s.getTime() <= e.getTime() ? e : s
    onChange(toStr(a), toStr(b))
    setOpen(false)
  }

  function preset(tipo: string) {
    const o = new Date()
    let s = new Date(o), e = new Date(o)
    if (tipo === 'oggi') { s = new Date(o); e = new Date(o) }
    else if (tipo === 'ieri') { s = new Date(o); s.setDate(s.getDate()-1); e = new Date(s) }
    else if (tipo === '3g') { s = new Date(o); s.setDate(s.getDate()-2); e = new Date(o) }
    else if (tipo === '7g') { s = new Date(o); s.setDate(s.getDate()-6); e = new Date(o) }
    else if (tipo === '30g') { s = new Date(o); s.setDate(s.getDate()-29); e = new Date(o) }
    else if (tipo === 'mese') { s = new Date(o.getFullYear(), o.getMonth(), 1); e = new Date(o.getFullYear(), o.getMonth()+1, 0) }
    else if (tipo === 'meseScorso') { s = new Date(o.getFullYear(), o.getMonth()-1, 1); e = new Date(o.getFullYear(), o.getMonth(), 0) }
    setStart(s); setEnd(e)
    onChange(toStr(s), toStr(e))
    setOpen(false)
  }

  function calendario(mese: Date, setMese: (d: Date) => void, isSx: boolean) {
    const anno = mese.getFullYear(), m = mese.getMonth()
    const primo = new Date(anno, m, 1)
    let startDay = primo.getDay() - 1; if (startDay < 0) startDay = 6
    const giorniMese = new Date(anno, m+1, 0).getDate()
    const celle: (Date | null)[] = []
    for (let i=0;i<startDay;i++) celle.push(null)
    for (let g=1;g<=giorniMese;g++) celle.push(new Date(anno, m, g))
    return (
      <div style={{ padding: '8px' }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:'8px' }}>
          {isSx ? <button onClick={()=>{ setMeseSx(new Date(anno,m-1,1)); setMeseDx(new Date(anno,m,1)) }} style={navBtn}>‹</button> : <span style={{width:'22px'}}></span>}
          <div style={{ fontWeight:'700', color:'#1a1a1a', fontSize:'13px' }}>{MESI[m]} {anno}</div>
          {!isSx ? <button onClick={()=>{ setMeseDx(new Date(anno,m+1,1)); setMeseSx(new Date(anno,m,1)) }} style={navBtn}>›</button> : <span style={{width:'22px'}}></span>}
        </div>
        <table style={{ borderCollapse:'separate', borderSpacing:'2px', tableLayout:'fixed', width:'224px' }}>
          <thead><tr>{GIORNI.map(g => <th key={g} style={{ width:'30px', height:'26px', fontSize:'11px', color:'#1a1a1a', fontWeight:'600', textAlign:'center' }}>{g}</th>)}</tr></thead>
          <tbody>
            {Array.from({length: Math.ceil(celle.length/7)}).map((_, r) => (
              <tr key={r}>
                {celle.slice(r*7, r*7+7).map((d, i) => {
                  if (!d) return <td key={i} style={{ width:'30px', height:'28px' }}></td>
                  const sel = sameDay(d,start) || sameDay(d,end)
                  const range = inRange(d, start, end)
                  return (
                    <td key={i} onClick={()=>clickGiorno(d)} style={{
                      width:'30px', height:'28px', textAlign:'center', fontSize:'12px', cursor:'pointer', borderRadius:'4px',
                      background: sel ? '#2563eb' : range ? '#dbeafe' : 'transparent',
                      color: sel ? '#fff' : '#1a1a1a', fontWeight: sel ? '700' : '400'
                    }}>{d.getDate()}</td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }

  const labelText = (fromStr(dal) ? fmtIt(fromStr(dal)) : fmtIt(oggi)) + ' - ' + (fromStr(al) ? fmtIt(fromStr(al)) : fmtIt(oggi))

  return (
    <div ref={ref} style={{ position:'relative', display:'inline-block' }}>
      <div onClick={()=>setOpen(!open)} style={{
        padding:'7px 12px', border:'1px solid #d1d5db', borderRadius:'6px', fontSize:'13px',
        color:'#1a1a1a', background:'#fff', cursor:'pointer', display:'flex', alignItems:'center', gap:'8px', whiteSpace:'nowrap'
      }}>
        <span>📅</span><span style={{ color:'#1a1a1a' }}>{labelText}</span><span style={{ color:'#1a1a1a' }}>▾</span>
      </div>
      {open && (
        <div style={{ position:'absolute', top:'40px', left:0, zIndex:1000, background:'#fff', border:'1px solid #d1d5db', borderRadius:'8px', boxShadow:'0 8px 24px rgba(0,0,0,0.15)', display:'flex' }}>
          <div style={{ display:'flex' }}>
            {calendario(meseSx, setMeseSx, true)}
            {calendario(meseDx, setMeseDx, false)}
          </div>
          <div style={{ borderLeft:'1px solid #eee', padding:'8px', display:'flex', flexDirection:'column', gap:'4px', minWidth:'130px' }}>
            {[['oggi','Oggi'],['ieri','Ieri'],['3g','Ultimi 3 giorni'],['7g','Ultimi 7 giorni'],['30g','Ultimi 30 giorni'],['mese','Questo mese'],['meseScorso','Ultimo mese']].map(([k,lab]) => (
              <button key={k} onClick={()=>preset(k)} style={presetBtn}>{lab}</button>
            ))}
            <div style={{ marginTop:'auto', display:'flex', gap:'6px', paddingTop:'8px' }}>
              <button onClick={()=>setOpen(false)} style={{ ...presetBtn, flex:1, textAlign:'center' as const }}>Annulla</button>
              <button onClick={applica} style={{ flex:1, padding:'6px', background:'#2563eb', color:'#fff', border:'none', borderRadius:'5px', fontSize:'12px', fontWeight:'700', cursor:'pointer' }}>Applica</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

const navBtn = { width:'22px', height:'22px', border:'none', background:'#f1f5f9', color:'#1a1a1a', borderRadius:'4px', cursor:'pointer', fontSize:'14px' } as const
const presetBtn = { padding:'6px 10px', border:'none', background:'transparent', color:'#1a1a1a', fontSize:'12px', textAlign:'left' as const, cursor:'pointer', borderRadius:'4px', width:'100%' } as const