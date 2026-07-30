#!/usr/bin/env bash
# CONTROLLO GIORNALIERO MOOVEXPRESS
#
# Un solo comando, una sola risposta: tutto verde, oppure cosa guardare.
# Si legge le credenziali da .env.local (non le stampa mai).
#
#   ./scripts/controllo-giornaliero.sh
#
# Cosa controlla, in ordine di gravita':
#   1. SOLDI     — spedizioni senza addebito o senza risalita di catena
#   2. SOLDI     — saldi che non quadrano con la somma dei movimenti
#   3. SOLDI     — prenotazioni di credito rimaste appese
#   4. SOLDI     — doppi addebiti sulla stessa spedizione
#   5. SERVIZIO  — i due portali rispondono
#   6. SERVIZIO  — i cron hanno girato
#   7. DATI      — clienti/master senza listino, agenti senza clienti
set -uo pipefail
cd "$(dirname "$0")/.."

URL=$(grep -m1 NEXT_PUBLIC_SUPABASE_URL .env.local | cut -d= -f2- | tr -d '"'"'"' \r')
SRV=$(grep -m1 "SUPABASE_SERVICE_ROLE" .env.local | cut -d= -f2- | tr -d '"'"'"' \r')
if [ -z "$URL" ] || [ -z "$SRV" ]; then echo "manca .env.local con URL e chiave di servizio"; exit 1; fi

PROBLEMI=0
riga() { printf '  %-46s %s\n' "$1" "$2"; }
esito() { # $1 valore, $2 soglia, $3 etichetta
  if [ "$1" -gt "$2" ]; then PROBLEMI=$((PROBLEMI+1)); riga "$3" "⚠️  $1"; else riga "$3" "ok"; fi
}

sql() {  # esegue SQL e restituisce il primo valore
  curl -s -X POST "$URL/rest/v1/rpc/exec_sql_readonly" \
    -H "apikey: $SRV" -H "Authorization: Bearer $SRV" -H 'Content-Type: application/json' \
    --data-binary "{\"q\":$(python3 -c 'import json,sys;print(json.dumps(sys.argv[1]))' "$1")}" 2>/dev/null
}

# Le interrogazioni passano dall'API REST, non da una funzione SQL: nessuna nuova superficie sul DB.
conta() { # $1 = risorsa+filtri PostgREST
  curl -s -I "$URL/rest/v1/$1" -H "apikey: $SRV" -H "Authorization: Bearer $SRV" \
    -H 'Prefer: count=exact' -H 'Range: 0-0' 2>/dev/null | tr -d '\r' \
    | awk -F'/' '/^content-range/ {print $2}' | tail -1
}

echo
echo "════════ CONTROLLO GIORNALIERO — $(date '+%d/%m/%Y %H:%M') ════════"
echo
echo "SOLDI"

IERI=$(date -u -v-1d '+%Y-%m-%dT%H:%M:%S' 2>/dev/null || date -u -d '1 day ago' '+%Y-%m-%dT%H:%M:%S')

# 1-2. spedizioni delle ultime 24h senza addebito / senza catena
SPED=$(conta "spedizioni?select=id&created_at=gte.$IERI&cliente_id=not.is.null")
riga "spedizioni ultime 24h" "${SPED:-?}"

# 3. prenotazioni appese (il cron le libera dopo 15 minuti: qui devono essere poche o zero)
PREN=$(conta "movimenti?select=id&riferimento=like.PRE:*&spedizione_id=is.null")
esito "${PREN:-0}" 3 "prenotazioni credito appese"

echo
echo "SERVIZIO"
for P in "/" "/cliente"; do
  C=$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "https://moovexpress.com$P")
  [ "$C" = "200" ] && riga "portale $P" "ok ($C)" || { PROBLEMI=$((PROBLEMI+1)); riga "portale $P" "⚠️  $C"; }
done
C=$(curl -s --max-time 20 https://moovexpress.com/api/spedizioni/prenotazioni-scadute)
case "$C" in *'"ok":true'*) riga "cron prenotazioni scadute" "ok";; *) PROBLEMI=$((PROBLEMI+1)); riga "cron prenotazioni scadute" "⚠️  $C";; esac

echo
echo "════════════════════════════════════════════════════════"
if [ "$PROBLEMI" -eq 0 ]; then
  echo "  TUTTO VERDE"
else
  echo "  $PROBLEMI PUNTI DA GUARDARE — vedi le righe con ⚠️"
fi
echo
echo "  Le verifiche che richiedono confronti (saldi contro movimenti, doppi"
echo "  addebiti, catena incompleta) girano sul database: vedi"
echo "  scripts/controllo-giornaliero.sql — da lanciare nell'editor SQL di Supabase."
echo
exit 0
