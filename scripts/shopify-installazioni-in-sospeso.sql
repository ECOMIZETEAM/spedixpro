-- PARTE 1 — INSTALLAZIONI SHOPIFY IN SOSPESO E UN NEGOZIO SHOPIFY = UNA RIGA SOLA.
-- DA APPLICARE PRIMA DEL RILASCIO DEL CODICE. La parte 2 (la riga di un negozio Shopify la scrive solo la
-- piattaforma) sta in scripts/shopify-integrazioni-solo-piattaforma.sql e va applicata DOPO il rilascio.
--
-- Perche': decisione D1 di Lorenzo del 21/10/2026. Un negozio mai visto, dopo l'autorizzazione, chiede «Hai
-- già un account MoovExpress?» (app/api/integrazioni/shopify/collega). Fra il ritorno da Shopify e la scelta
-- il token del negozio aspetta in shopify_pending, che esiste dal 3/07 ed e' vuota (0 righe il 21/10). A
-- luglio la riga si ritrovava per NOME del negozio, che e' pubblico, e la rivendicava qualunque cliente
-- entrato. Ora si ritrova solo con un gettone casuale da 256 bit che sta in un cookie httpOnly del browser
-- che ha fatto l'autorizzazione: qui c'e' solo la sua impronta sha256 (chiave_hash). Vale 15 minuti
-- (scade_il) e 5 password sbagliate la cancellano (tentativi). Il codice e' lib/shopifyCollega.ts.
--
-- Prima del rilascio perche' senza queste colonne il callback non riesce a salvare l'installazione e un
-- negozio nuovo si ferma su «collegamento non salvato» (i negozi gia' collegati no: non passano da qui). Il
-- codice in produzione fino al rilascio non usa shopify_pending, quindi per lui non cambia niente.
-- Idempotente: si puo' rilanciare.
--
-- Dopo: advisors di sicurezza (obiettivo zero errori). shopify_pending ha RLS senza policy di proposito: la
-- legge e scrive solo il client di servizio, che la RLS non la guarda. L'advisor lo segnala come
-- informazione, non come errore.

begin;

-- 1) Le tre colonne nuove. Nullable: una riga senza impronta o senza scadenza non si puo' prendere (il codice
--    la cerca per impronta e la considera scaduta se scade_il manca), e cosi' lo script resta rilanciabile
--    anche se nel frattempo qualcuno avesse scritto righe col disegno vecchio.
alter table public.shopify_pending add column if not exists chiave_hash text;
alter table public.shopify_pending add column if not exists scade_il timestamptz;
alter table public.shopify_pending add column if not exists tentativi integer not null default 0;

-- 2) Un'impronta, una riga: e' la chiave con cui la pagina della scelta ritrova l'installazione.
create unique index if not exists shopify_pending_chiave_hash_key on public.shopify_pending (chiave_hash);

-- 3) Una riga per negozio: l'upsert del callback (onConflict 'shop') sostituisce l'installazione precedente,
--    come Shopify sostituisce il token. Il codice di luglio faceva gia' upsert su shop, quindi un vincolo
--    unico c'e' probabilmente gia' (non verificato: il connettore SQL era scollegato). Si crea solo se manca
--    un indice unico sulla sola colonna shop, per non averne due uguali.
do $$
begin
  if not exists (
    select 1
    from pg_index i
    join pg_class t on t.oid = i.indrelid
    join pg_namespace n on n.oid = t.relnamespace
    join pg_attribute a on a.attrelid = t.oid and a.attnum = i.indkey[0]
    where n.nspname = 'public' and t.relname = 'shopify_pending'
      and i.indisunique and i.indnkeyatts = 1 and i.indpred is null and a.attname = 'shop'
  ) then
    create unique index shopify_pending_shop_key on public.shopify_pending (shop);
  end if;
end $$;

-- 4) Tabella chiusa: dentro ci sono token che aprono gli ordini di un negozio. Revocare «da public» non basta
--    (CLAUDE.md): si revoca esplicitamente ad anon e authenticated.
alter table public.shopify_pending enable row level security;
revoke all on table public.shopify_pending from anon, authenticated;

-- 5) UN NEGOZIO SHOPIFY, UNA RIGA IN integrazioni. La regola «un negozio = un cliente» vive nel codice
--    (lib/shopifyCollega.ts), ma due richieste nello stesso istante possono leggere tutte e due «nessuna riga»
--    e inserirne due: da li' ogni lettura del negozio da' errore e il negoziante non entra piu' finche'
--    qualcuno non ne cancella una a mano. Il 21/10/2026: 1 riga Shopify (quickstart-adf6194a), 0 doppioni.
--    Se un giorno ci fossero doppioni, questa istruzione fallisce e annulla tutto lo script: prima si guarda
--      select identificativo, count(*) from public.integrazioni
--      where piattaforma = 'shopify' group by 1 having count(*) > 1;
create unique index if not exists integrazioni_shopify_negozio_unico
  on public.integrazioni (identificativo) where piattaforma = 'shopify';

commit;

-- Verifica dopo l'applicazione (sola lettura), una riga sola:
--   select
--     (select string_agg(column_name, ', ' order by ordinal_position) from information_schema.columns
--       where table_schema = 'public' and table_name = 'shopify_pending') as colonne,
--     (select string_agg(indexname, ', ') from pg_indexes
--       where schemaname = 'public' and tablename in ('shopify_pending', 'integrazioni')
--         and indexname in ('shopify_pending_chiave_hash_key', 'shopify_pending_shop_key', 'integrazioni_shopify_negozio_unico')) as indici,
--     (select relrowsecurity from pg_class where oid = 'public.shopify_pending'::regclass) as rls_attiva,
--     (select count(*) from information_schema.role_table_grants
--       where table_schema = 'public' and table_name = 'shopify_pending' and grantee in ('anon', 'authenticated')) as permessi_utenti;
-- Atteso: colonne con chiave_hash, scade_il, tentativi; indici almeno shopify_pending_chiave_hash_key e
-- integrazioni_shopify_negozio_unico; rls_attiva true; permessi_utenti 0.
