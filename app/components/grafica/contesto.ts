'use client'
import { createContext } from 'react'

// Dentro la cornice della grafica nuova le pagine lo sanno da qui: la Plancia sceglie la versione nuova solo quando
// la cornice nuova c'è (con la grafica di oggi questo contesto resta spento e le pagine non cambiano di un pixel).
// luce (mattina, giorno, tramonto, notte) e tema (giorno o notte) arrivano dalla cornice, decisi già sul server; chi
// è: per tenere le copie in sessione di un utente separate da quelle di un altro nella stessa scheda.
export const GraficaNuova = createContext<{ attiva: boolean; ruolo: string; luce: string; tema: string; chi: string; entrata: boolean; proposta: string }>({ attiva: false, ruolo: '', luce: 'argilla', tema: 'giorno', chi: '', entrata: false, proposta: '' })
