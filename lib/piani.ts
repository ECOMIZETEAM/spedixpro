// Piani di abbonamento. Per ora solo Enterprise (master); gli Smart (clienti) verranno dopo.
export type Piano = { id: string; nome: string; limite: number; prezzo: number }

export const PIANI_ENTERPRISE: Piano[] = [
  { id: 'enterprise_5k',   nome: 'Enterprise 5K',   limite: 5000,   prezzo: 139 },
  { id: 'enterprise_10k',  nome: 'Enterprise 10K',  limite: 10000,  prezzo: 230 },
  { id: 'enterprise_20k',  nome: 'Enterprise 20K',  limite: 20000,  prezzo: 340 },
  { id: 'enterprise_50k',  nome: 'Enterprise 50K',  limite: 50000,  prezzo: 590 },
  { id: 'enterprise_80k',  nome: 'Enterprise 80K',  limite: 80000,  prezzo: 870 },
  { id: 'enterprise_100k', nome: 'Enterprise 100K', limite: 100000, prezzo: 1090 },
  { id: 'enterprise_120k', nome: 'Enterprise 120K', limite: 120000, prezzo: 1300 },
  { id: 'enterprise_150k', nome: 'Enterprise 150K', limite: 150000, prezzo: 1620 },
]

// Piani Smart (clienti) — pronti per quando li attiviamo
export const PIANI_SMART: Piano[] = [
  { id: 'smart_free',  nome: 'Free',  limite: 50,   prezzo: 0 },
  { id: 'smart_easy',  nome: 'Easy',  limite: 1000, prezzo: 31 },
  { id: 'smart_basic', nome: 'Basic', limite: 2000, prezzo: 54 },
  { id: 'smart_pro',   nome: 'Pro',   limite: 3000, prezzo: 100 },
]

export function pianoById(id: string): Piano | undefined {
  return [...PIANI_ENTERPRISE, ...PIANI_SMART].find(p => p.id === id)
}

// 'YYYY-MM' del mese corrente (in una route handler Node si può usare new Date()).
export function meseCorrente(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
