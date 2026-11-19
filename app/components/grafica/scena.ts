// La base 3D della Plancia nuova (scritto dallo studio esempi-v6/v11/luce, NON a mano): la misura dell'immagine a
// densità 1, i punti degli oggetti proiettati con la camera dello studio (in percentuale dell'immagine, uguali per le
// quattro luci), i quattro spigoli dell'insegna (quadrato e fascia del nome, dall'alto a sinistra in senso orario) e il
// colore della pagina sotto ogni luce.
export const SCENA = {
 "w": 1800,
 "h": 1080,
 "punti": {
  "partite": {
   "x": 59.04,
   "y": 34.44
  },
  "transito": {
   "x": 69.93,
   "y": 48.16
  },
  "giacenze": {
   "x": 52.58,
   "y": 31.63
  },
  "contrassegni": {
   "x": 73.49,
   "y": 33.97
  },
  "pedana": {
   "x": 65.47,
   "y": 41.29
  },
  "quadrato_1": {
   "x": 55.45,
   "y": 26.87
  },
  "quadrato_2": {
   "x": 56.21,
   "y": 27.36
  },
  "quadrato_3": {
   "x": 56.25,
   "y": 28.85
  },
  "quadrato_4": {
   "x": 55.49,
   "y": 28.35
  },
  "nome_1": {
   "x": 56.45,
   "y": 27.77
  },
  "nome_2": {
   "x": 61.8,
   "y": 31.26
  },
  "nome_3": {
   "x": 61.8,
   "y": 32.41
  },
  "nome_4": {
   "x": 56.47,
   "y": 28.9
  },
  "porta_0": {
   "x": 56.34,
   "y": 29.25
  },
  "piazzale_0": {
   "x": 55.11,
   "y": 33.44
  },
  "porta_1": {
   "x": 57.85,
   "y": 30.25
  },
  "piazzale_1": {
   "x": 56.61,
   "y": 34.47
  },
  "porta_2": {
   "x": 59.38,
   "y": 31.26
  },
  "piazzale_2": {
   "x": 58.14,
   "y": 35.53
  },
  "porta_3": {
   "x": 60.95,
   "y": 32.29
  },
  "piazzale_3": {
   "x": 59.7,
   "y": 36.61
  },
  "porta_4": {
   "x": 62.54,
   "y": 33.35
  },
  "piazzale_4": {
   "x": 61.28,
   "y": 37.71
  },
  "porta_5": {
   "x": 64.17,
   "y": 34.42
  },
  "piazzale_5": {
   "x": 62.9,
   "y": 38.82
  },
  "porta_6": {
   "x": 65.82,
   "y": 35.52
  },
  "piazzale_6": {
   "x": 64.55,
   "y": 39.96
  },
  "porta_7": {
   "x": 67.51,
   "y": 36.63
  },
  "piazzale_7": {
   "x": 66.23,
   "y": 41.13
  },
  "via_a_0": {
   "x": 64.57,
   "y": 42.5
  },
  "via_a_1": {
   "x": 66.67,
   "y": 45.33
  },
  "via_a_2": {
   "x": 68.77,
   "y": 47.87
  },
  "via_a_3": {
   "x": 69.22,
   "y": 50.58
  },
  "via_a_4": {
   "x": 68.18,
   "y": 53.67
  },
  "via_b_0": {
   "x": 47.97,
   "y": 37.06
  },
  "via_b_1": {
   "x": 52.87,
   "y": 40.38
  },
  "via_b_2": {
   "x": 58.01,
   "y": 42.58
  },
  "via_b_3": {
   "x": 62.08,
   "y": 42.5
  },
  "via_b_4": {
   "x": 63.72,
   "y": 42.01
  }
 },
 "fondi": {
  "giorno": "#E8DAC4",
  "mattina": "#F0E8D5",
  "tramonto": "#DDCAB7",
  "notte": "#161E2B"
 }
} as const
