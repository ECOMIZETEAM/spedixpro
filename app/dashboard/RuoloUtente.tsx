'use client'
import { createContext, useContext, type ReactNode } from 'react'

// IL RUOLO DI CHI GUARDA, gia' letto dal layout sul server, a disposizione delle pagine nel browser.
// Serve alla home per far partire i report insieme a /api/dashboard invece che dopo: quali report si
// vedono dipende dal ruolo (l'agente ha il suo guadagno, non quelli del master), e senza questo la
// pagina lo sapeva solo dalla risposta di /api/dashboard. Non e' un permesso: decide solo cosa
// chiedere prima. Cosa mostrare lo decide ancora la risposta, e ogni rotta controlla da se'.
export type ProfiloUtente = { ruolo: string; haMaster: boolean }

const Ctx = createContext<ProfiloUtente | null>(null)

export function RuoloUtente({ ruolo, haMaster, children }: ProfiloUtente & { children: ReactNode }) {
  return <Ctx.Provider value={{ ruolo, haMaster }}>{children}</Ctx.Provider>
}

export const useProfiloUtente = (): ProfiloUtente | null => useContext(Ctx)
