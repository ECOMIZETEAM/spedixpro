#!/bin/sh
# Lancia il load test leggendo URL + chiave anon da .env.local (non le scrive nel repo).
# Uso:  EMAIL=tua@mail PASSWORD=xxx ROLE=master ./loadtest/run.sh
#       ROLE = master (default) | cliente
set -e
DIR="$(cd "$(dirname "$0")" && pwd)"

# carica le variabili da .env.local
set -a
. "$DIR/../.env.local"
set +a

export SUPA_URL="$NEXT_PUBLIC_SUPABASE_URL"
export SUPA_ANON="$NEXT_PUBLIC_SUPABASE_ANON_KEY"
export ROLE="${ROLE:-master}"

: "${EMAIL:?Imposta EMAIL con un account reale, es: EMAIL=tu@mail PASSWORD=xxx ./loadtest/run.sh}"
: "${PASSWORD:?Imposta PASSWORD}"

echo "Target: $SUPA_URL  |  ruolo: $ROLE  |  utente: $EMAIL"
k6 run "$DIR/dashboard.js"
