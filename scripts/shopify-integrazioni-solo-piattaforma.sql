-- PARTE 2 — LA RIGA DI UN NEGOZIO SHOPIFY IN integrazioni LA SCRIVE SOLO LA PIATTAFORMA.
-- DA APPLICARE DOPO IL RILASCIO DEL CODICE che la accompagna (la parte 1 e' scripts/shopify-installazioni-in-sospeso.sql).
--
-- PERCHE' DOPO: il codice in produzione fino a quel rilascio (7718f6b5, lib/shopify.ts riga 102) salva il token
-- rinnovato con il client che riceve, e da «Sincronizza» nel portale e' la sessione del cliente: questa guardia
-- lo rifiuterebbe. Dal codice nuovo il token rinnovato lo salva sempre il client di servizio.
--
-- PERCHE' SERVE (revisione del 21/10/2026). Su integrazioni RLS e permessi lasciano scrivere la sessione del
-- cliente: il portale ci scrive per collegare WooCommerce e PrestaShop, per «Sincronizza» e «Scollega», e la
-- policy guarda il cliente o la rete, non la piattaforma. Cosi' un cliente qualunque, con una POST diretta a
-- /rest/v1/integrazioni, poteva creare la riga Shopify del negozio di UN ALTRO col proprio cliente_id. Quando il
-- negoziante vero installava, il callback la prendeva per «negozio gia' collegato»: il token nuovo finiva sulla
-- riga dell'attaccante, il cron gli portava nel portale gli ordini con nomi, indirizzi e telefoni dei
-- compratori, e lui poteva evadere ordini sul negozio. Una guardia nelle rotte non basta: la scrittura non
-- passa dalle rotte.
--
-- Con la sessione di un utente (ruolo anon o authenticated), su una riga Shopify:
-- - non si inserisce, e una riga di un'altra piattaforma non diventa Shopify;
-- - si cambiano SOLO ultimo_sync, ordini_totali ed errore: e' quello che scrive «Sincronizza» dal portale con
--   la sessione del cliente (lib/shopifySync.ts). Tutto il resto (negozio, cliente, master, credenziali, stato,
--   nome) lo scrive il client di servizio: callback, scelta dell'account, rinnovo del token, disinstallazione.
--   E' un elenco di quello che si PUO' cambiare: una colonna aggiunta domani resta chiusa finche' qualcuno non
--   decide di aprirla;
-- - la cancellazione resta («Scollega» del proprietario, dentro la sua RLS).
-- current_user e non il ruolo del token: la funzione e' SECURITY INVOKER, quindi current_user e' il ruolo che
-- scrive. Il client di servizio, le migrazioni e le funzioni SECURITY DEFINER (che hanno i loro controlli)
-- passano.
--
-- PRIMA DI APPLICARE (sola lettura):
--   select policyname, cmd, roles, qual, with_check from pg_policies where schemaname = 'public' and tablename = 'integrazioni';
--   select grantee, privilege_type from information_schema.role_table_grants
--    where table_schema = 'public' and table_name = 'integrazioni' and grantee in ('anon', 'authenticated');
--   -- i trigger gia' presenti: i BEFORE partono in ordine alfabetico, e uno che cambiasse una colonna a ogni
--   -- scrittura farebbe rifiutare anche «Sincronizza»:
--   select tgname, pg_get_triggerdef(oid) from pg_trigger where tgrelid = 'public.integrazioni'::regclass and not tgisinternal;
--   -- le funzioni del database che scrivono su integrazioni: una SECURITY INVOKER chiamata da un utente su una
--   -- riga Shopify verrebbe rifiutata:
--   select p.proname, p.prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public' and p.prosrc ilike '%integrazioni%';

begin;

create or replace function public.fn_integrazioni_shopify_solo_piattaforma()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  campo text;
begin
  if current_user not in ('anon', 'authenticated') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if lower(btrim(coalesce(new.piattaforma, ''))) = 'shopify' then
      raise exception 'Un negozio Shopify si collega solo installando l''app da Shopify'
        using errcode = '42501';
    end if;
    return new;
  end if;

  if lower(btrim(coalesce(old.piattaforma, ''))) <> 'shopify'
     and lower(btrim(coalesce(new.piattaforma, ''))) <> 'shopify' then
    return new;
  end if;

  select e.key into campo
    from jsonb_each(to_jsonb(new)) as e
   where e.key not in ('ultimo_sync', 'ordini_totali', 'errore')
     and e.value is distinct from (to_jsonb(old) -> e.key)
   limit 1;
  if campo is not null then
    raise exception 'Sul collegamento di un negozio Shopify questo campo lo scrive solo la piattaforma (campo %)', campo
      using errcode = '42501';
  end if;
  return new;
end $$;

-- Un trigger non controlla EXECUTE quando scatta (solo chi lo crea deve averlo): togliere l'esecuzione a tutti
-- non lo ferma, e la funzione non e' chiamabile da fuori.
revoke all on function public.fn_integrazioni_shopify_solo_piattaforma() from public, anon, authenticated;

drop trigger if exists integrazioni_shopify_solo_piattaforma on public.integrazioni;
create trigger integrazioni_shopify_solo_piattaforma
  before insert or update on public.integrazioni
  for each row execute function public.fn_integrazioni_shopify_solo_piattaforma();

commit;

-- PROVA DELLA GUARDIA RIFACENDO L'ATTACCO, SU UNA RIGA FINTA, IN UNA TRANSAZIONE ANNULLATA.
-- Mai sulla riga vera di un negozio: un'istruzione eseguita per sbaglio fuori dalla transazione ne
-- svuoterebbe il token. Qui si crea una riga di prova del cliente demo (9923e14b), si entra come il suo utente
-- e si prova; alla fine rollback, non resta niente. Il risultato esce fra i messaggi (NOTICE): atteso
-- «stato: rifiutato | credenziali: rifiutato | inserimento: rifiutato | sincronizza: passato».
--
--   begin;
--   insert into public.integrazioni (master_id, cliente_id, piattaforma, identificativo, credenziali, stato)
--     select c.master_id, c.id, 'shopify', 'prova-guardia-21-10.myshopify.com', '{"access_token":"finto"}'::jsonb, 'attivo'
--       from public.clienti c where c.id = '9923e14b-0b4f-45b7-8100-e1699d69a69b';
--   select set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'sub',
--     (select u.id from public.utenti u where u.cliente_id = '9923e14b-0b4f-45b7-8100-e1699d69a69b' and u.ruolo = 'cliente' limit 1))::text, true);
--   set local role authenticated;
--   do $$
--   declare esito text := '';
--   begin
--     begin
--       update public.integrazioni set stato = 'errore' where identificativo = 'prova-guardia-21-10.myshopify.com';
--       esito := esito || 'stato: PASSATO (male) | ';
--     exception when insufficient_privilege then esito := esito || 'stato: rifiutato | ';
--     end;
--     begin
--       update public.integrazioni set credenziali = '{}'::jsonb where identificativo = 'prova-guardia-21-10.myshopify.com';
--       esito := esito || 'credenziali: PASSATO (male) | ';
--     exception when insufficient_privilege then esito := esito || 'credenziali: rifiutato | ';
--     end;
--     begin
--       insert into public.integrazioni (master_id, cliente_id, piattaforma, identificativo, credenziali, stato)
--         select master_id, cliente_id, 'shopify', 'prova-guardia-bis-21-10.myshopify.com', '{}'::jsonb, 'disconnesso'
--           from public.integrazioni where identificativo = 'prova-guardia-21-10.myshopify.com';
--       esito := esito || 'inserimento: PASSATO (male) | ';
--     exception when insufficient_privilege then esito := esito || 'inserimento: rifiutato | ';
--     end;
--     begin
--       update public.integrazioni set ultimo_sync = now(), errore = null where identificativo = 'prova-guardia-21-10.myshopify.com';
--       esito := esito || case when found then 'sincronizza: passato' else 'sincronizza: 0 righe (guardare la RLS)' end;
--     exception when others then esito := esito || 'sincronizza: RIFIUTATO (male) ' || sqlerrm;
--     end;
--     raise notice '%', esito;
--   end $$;
--   rollback;
