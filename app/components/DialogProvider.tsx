'use client'
import { createContext, useContext, useState, useCallback, useRef, ReactNode } from 'react'

// Dialog MoovExpress: sostituisce i popup nativi del browser (confirm/alert/prompt) con modali nostri.
// Uso:
//   const dialog = useDialog()
//   if (await dialog.confirm({ title:'Eliminare?', message:'…', danger:true })) { … }
//   await dialog.alert({ title:'Fatto', message:'…' })
//   const val = await dialog.prompt({ title:'Nome', defaultValue:'' })  // string | null

type DialogTipo = 'confirm' | 'alert' | 'prompt'
type DialogCfg = {
  tipo: DialogTipo
  title?: string
  message?: ReactNode
  confirmText?: string
  cancelText?: string
  danger?: boolean
  defaultValue?: string
  placeholder?: string
}
type DialogAPI = {
  confirm: (c: Omit<DialogCfg, 'tipo'>) => Promise<boolean>
  alert: (c: Omit<DialogCfg, 'tipo'>) => Promise<void>
  prompt: (c: Omit<DialogCfg, 'tipo'>) => Promise<string | null>
}

const Ctx = createContext<DialogAPI | null>(null)

export function useDialog(): DialogAPI {
  const v = useContext(Ctx)
  if (!v) throw new Error('useDialog deve stare dentro <DialogProvider>')
  return v
}

export function DialogProvider({ children }: { children: ReactNode }) {
  const [cfg, setCfg] = useState<DialogCfg | null>(null)
  const [val, setVal] = useState('')
  const resolver = useRef<((v: any) => void) | null>(null)

  const apri = useCallback((c: DialogCfg): Promise<any> => {
    setVal(c.defaultValue || '')
    setCfg(c)
    return new Promise((resolve) => { resolver.current = resolve })
  }, [])

  const chiudi = useCallback((risultato: any) => {
    setCfg(null)
    const r = resolver.current
    resolver.current = null
    if (r) r(risultato)
  }, [])

  const api: DialogAPI = {
    confirm: (c) => apri({ ...c, tipo: 'confirm' }),
    alert: (c) => apri({ ...c, tipo: 'alert' }),
    prompt: (c) => apri({ ...c, tipo: 'prompt' }),
  }

  const isPrompt = cfg?.tipo === 'prompt'
  const isAlert = cfg?.tipo === 'alert'

  return (
    <Ctx.Provider value={api}>
      {children}
      {cfg && (
        <div
          onClick={() => chiudi(isAlert ? undefined : (isPrompt ? null : false))}
          style={{ position: 'fixed', inset: 0, background: 'rgba(15,15,15,0.55)', zIndex: 100000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ background: '#fff', borderRadius: '12px', maxWidth: '420px', width: '100%', padding: '24px', boxShadow: '0 20px 60px rgba(0,0,0,.35)' }}
          >
            {cfg.title && <div style={{ fontSize: '17px', fontWeight: 800, color: '#1a1a1a', marginBottom: cfg.message ? '6px' : '18px' }}>{cfg.title}</div>}
            {cfg.message && <div style={{ fontSize: '13.5px', color: '#555', lineHeight: 1.5, marginBottom: isPrompt ? '14px' : '20px' }}>{cfg.message}</div>}

            {isPrompt && (
              <input
                value={val}
                onChange={(e) => setVal(e.target.value)}
                placeholder={cfg.placeholder}
                autoFocus
                onKeyDown={(e) => { if (e.key === 'Enter') chiudi(val) }}
                style={{ width: '100%', padding: '9px 12px', border: '1px solid #e2e2e2', borderRadius: '8px', fontSize: '14px', color: '#1a1a1a', outline: 'none', marginBottom: '20px', boxSizing: 'border-box' }}
              />
            )}

            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
              {!isAlert && (
                <button
                  onClick={() => chiudi(isPrompt ? null : false)}
                  style={{ background: '#fff', color: '#1a1a1a', border: '1px solid #ddd', borderRadius: '8px', padding: '9px 18px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}
                >{cfg.cancelText || 'Annulla'}</button>
              )}
              <button
                onClick={() => chiudi(isPrompt ? val : (isAlert ? undefined : true))}
                style={{ background: cfg.danger ? '#dc2626' : '#f97316', color: '#fff', border: 'none', borderRadius: '8px', padding: '9px 20px', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}
              >{cfg.confirmText || (isAlert ? 'OK' : (cfg.danger ? 'Elimina' : 'Conferma'))}</button>
            </div>
          </div>
        </div>
      )}
    </Ctx.Provider>
  )
}
