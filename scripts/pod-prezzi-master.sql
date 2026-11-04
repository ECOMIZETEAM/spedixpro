-- POD CHIESTE DA UN MASTER AL SUO MASTER SUPERIORE: SI PAGANO COME QUELLE DEI CLIENTI.
--
-- Decisione del committente, 04/11/2026. Fino a quel giorno il listino POD valeva solo per i
-- clienti: quando un master chiedeva la POD al master sopra di lui (es. QUICK SRL a MULTIEXPRESS,
-- 10 richieste dal 15/10 al 03/11, TK-07821 su SDA EXPRESS L 282343J020438) nessuno pagava niente,
-- e MULTIEXPRESS cercava e caricava la POD gratis.
--
-- Una regola ora dice A CHI vale: `destinatario` = 'cliente' (come sempre: `cliente_id` = un
-- cliente, nullo = tutti i clienti) oppure 'master' (`sottomaster_id` = un master sotto, nullo =
-- tutti i master sotto). Le regole che c'erano restano tutte 'cliente': nessun master paga una POD
-- finche' il suo master superiore non mette un prezzo apposta per i master. Un predefinito per i
-- clienti NON vale per i master: GTS ha 3,30 € per i suoi clienti, e NUOVAPOSTA 2.0 (che sta sotto
-- GTS) non deve trovarsi a pagarli senza che GTS l'abbia deciso.
-- La pagano sia il master che APRE la POD dal pulsante della spedizione (all'apertura), sia quello
-- che INOLTRA al suo superiore la POD di un suo cliente (all'inoltro): l'inoltro era la strada piu'
-- battuta (Velox 71, spedizioni 2000 62, GTS 40 inoltrate a MULTIEXPRESS), e senza bastava
-- inoltrare invece di aprire per non pagare. Decisione del committente, 04/11/2026.
--
-- ORDINE DI RILASCIO: prima questo file, poi il codice. Il codice nuovo filtra per `destinatario`
-- (senza la colonna il calcolo del prezzo fallisce e l'apertura si rifiuta, invece di regalare la
-- POD); il codice vecchio, finche' gira, non conosce le regole 'master', e non ce n'e' nessuna fino
-- a quando un master non le crea dalla pagina nuova.
-- PER TORNARE AL CODICE VECCHIO, prima: update pod_prezzi set attivo = false where destinatario = 'master'
-- (il codice vecchio le scambierebbe per regole dei clienti: "tutti i master, 3 €" diventerebbe
-- il predefinito di tutti i clienti senza una regola loro).

alter table public.pod_prezzi add column if not exists destinatario text not null default 'cliente';
alter table public.pod_prezzi add column if not exists sottomaster_id uuid references public.masters(id) on delete cascade;

alter table public.pod_prezzi drop constraint if exists pod_prezzi_destinatario;
alter table public.pod_prezzi add constraint pod_prezzi_destinatario check (
  (destinatario = 'cliente' and sottomaster_id is null)
  or (destinatario = 'master' and cliente_id is null)
);

-- Una regola sola per bersaglio: ora il bersaglio comprende anche a chi vale.
drop index if exists public.pod_prezzi_uniq;
create unique index pod_prezzi_uniq on public.pod_prezzi (
  master_id,
  destinatario,
  coalesce(cliente_id, '00000000-0000-0000-0000-000000000000'::uuid),
  coalesce(sottomaster_id, '00000000-0000-0000-0000-000000000000'::uuid),
  coalesce(corriere_id, '00000000-0000-0000-0000-000000000000'::uuid),
  coalesce(vettore, '')
);

-- La tabella resta solo del server (come prima): RLS attiva, nessuna policy, niente ad anon e
-- authenticated. Le colonne nuove non cambiano niente, ma si ripete per non dipendere da com'era.
alter table public.pod_prezzi enable row level security;
revoke all on table public.pod_prezzi from anon, authenticated;

-- CHI HA GIA' PAGATO L'INOLTRO di questa POD: { "<master che ha inoltrato>": { padre, prezzo, il } }.
-- Una POD sale un gradino alla volta (Velox → MULTIEXPRESS → il suo superiore), e ogni gradino
-- paga il suo una volta sola: la chiave e' il master che inoltra.
alter table public.tickets add column if not exists pod_inoltri jsonb;

-- ADDEBITO DELL'INOLTRO: la presa (la chiave del master in pod_inoltri) e il movimento nella stessa
-- transazione, come addebita_pod (scripts/pod-addebito.sql): un doppio clic o una risposta persa non
-- fanno pagare due volte, e non resta mai "pagato" senza movimento. Il prezzo lo calcola il server
-- (lib/pod-prezzo, listino del superiore per i master sotto) e lo passa: questa funzione la chiama
-- solo la chiave di servizio. Movimento come le altre POD: 'rettifica', "POD <ldv>", riferimento
-- "POD-<ldv>" (il marcatore che tiene la POD fuori dai calcoli del nolo). Ritorna l'importo addebitato.
create or replace function public.addebita_pod_inoltro(
  p_ticket_id uuid, p_master_id uuid, p_padre_id uuid, p_prezzo numeric, p_created_by uuid default null)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  t record;
  v_ldv text;
begin
  if p_master_id is null or p_padre_id is null then
    return 0;
  end if;
  update public.tickets
     set pod_inoltri = coalesce(pod_inoltri, '{}'::jsonb)
           || jsonb_build_object(p_master_id::text,
                jsonb_build_object('padre', p_padre_id, 'prezzo', coalesce(p_prezzo, 0), 'il', now()))
   where id = p_ticket_id
     and categoria = 'pod'
     and not (coalesce(pod_inoltri, '{}'::jsonb) ? p_master_id::text)
  returning spedizione_id, oggetto into t;
  if not found then
    return 0;                                      -- gia' pagato da questo master, o non e' una POD
  end if;
  if coalesce(p_prezzo, 0) <= 0 then
    return 0;                                      -- inoltro gratuito: segnato, nessun movimento
  end if;
  v_ldv := left(regexp_replace(coalesce(t.oggetto, ''), '^\s+|\s+$', '', 'g'), 40);
  perform public.registra_movimento_master(
    p_padre_id, p_master_id, 'rettifica', 'POD ' || v_ldv, -p_prezzo,
    'POD-' || v_ldv, t.spedizione_id, p_created_by);
  return p_prezzo;
end;
$$;

revoke all on function public.addebita_pod_inoltro(uuid, uuid, uuid, numeric, uuid) from public, anon, authenticated;
grant execute on function public.addebita_pod_inoltro(uuid, uuid, uuid, numeric, uuid) to service_role;
