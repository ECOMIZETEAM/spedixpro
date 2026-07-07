# Load test — capacità DB

Test READ-ONLY che simula N utenti concorrenti sui due hot path (dashboard + elenco
spedizioni), puntando diretto a Supabase/PostgREST. Serve a sapere **quanti utenti
concorrenti regge il tier attuale** prima di doverlo potenziare. Non crea spedizioni.

## 1. Installa k6 (una volta sola)
```
brew install k6
```

## 2. Lancia il test
Con un account reale (il tuo master, o un cliente):
```
EMAIL=tua@mail PASSWORD=lapassword ROLE=master ./loadtest/run.sh
```
- `ROLE=master` (default) oppure `ROLE=cliente`
- URL e chiave anon vengono letti da `.env.local` (non serve incollarli).

## 3. Mentre gira, guarda la CPU del DB
Supabase → Dashboard → **Reports → Database** (o Compute/CPU).
- CPU sotto ~60% a 500 utenti → sei tranquillo con il tier attuale.
- CPU sopra ~85% → è ora di salire di compute (Small → Medium → Large).

## Come leggere l'output di k6
- `dashboard_ms` e `elenco_spedizioni_ms` → tempi di risposta (guarda p95).
- `http_req_failed` → % di errori (deve restare ~0).
- Le soglie (p95 < 1s, errori < 1%) sono in `dashboard.js`, modificabili.

La rampa arriva a **500 utenti concorrenti**. Per un test più leggero/pesante cambia
gli `stages` in `dashboard.js`.
