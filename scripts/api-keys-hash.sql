-- SICUREZZA — la chiave API dei conti all'ingrosso finiva IN CHIARO nei log edge di Supabase:
-- l'autenticazione (lib/api-auth.ts) la cercava PER VALORE (.eq('chiave', token)) e PostgREST mette
-- il valore del filtro nell'URL, che Supabase registra (il 26/10: 244.051 volte in 24h).
--
-- Rimedio: cercare per HASH. La chiave resta solo nell'header Authorization; nell'URL finisce
-- l'hash, inutile a chi legge i log. Questo script e' ADDITIVO e NON cambia l'auth: dopo averlo
-- eseguito l'auth attuale (per valore) continua a funzionare identica, e si popola chiave_hash.
--
-- ORDINE OBBLIGATORIO:
--   1) esegui QUESTO SQL  (aggiunge colonna + trigger + backfill: nulla si rompe, l'auth vecchia regge)
--   2) SOLO DOPO rilascia il codice che cerca per chiave_hash (ramo fix/api-key-hash-2026-11-14)
-- Se si rilascia il codice PRIMA dello SQL, la colonna non esiste e NESSUNA chiave viene trovata:
-- tutte le API si fermerebbero. Da qui i due passi separati.
--
-- sha256 esadecimale: identico tra Postgres (extensions.digest) e Node (crypto.createHash).

alter table public.api_keys add column if not exists chiave_hash text;

-- Il trigger tiene chiave_hash allineata da sola: nessun punto di creazione (condivisione-engine,
-- cliente/api-keys) va modificato.
create or replace function public.fn_api_keys_hash()
 returns trigger
 language plpgsql
 set search_path to 'public'
as $function$
begin
  new.chiave_hash := encode(extensions.digest(coalesce(new.chiave, ''), 'sha256'), 'hex');
  return new;
end $function$;

drop trigger if exists trg_api_keys_hash on public.api_keys;
create trigger trg_api_keys_hash
  before insert or update of chiave on public.api_keys
  for each row execute function public.fn_api_keys_hash();

-- backfill delle chiavi esistenti
update public.api_keys
   set chiave_hash = encode(extensions.digest(coalesce(chiave, ''), 'sha256'), 'hex')
 where chiave_hash is null or chiave_hash = '';

create index if not exists idx_api_keys_chiave_hash on public.api_keys (chiave_hash);

revoke all on function public.fn_api_keys_hash() from public, anon, authenticated;

-- Verifica: nessuna chiave attiva deve restare senza hash (deve dare 0).
-- select count(*) filter (where chiave_hash is null or chiave_hash='') as senza_hash from public.api_keys;
