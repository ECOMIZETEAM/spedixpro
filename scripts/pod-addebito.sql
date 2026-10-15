-- ADDEBITO DI UNA RICHIESTA POD: la presa della richiesta e il movimento in UNA transazione.
--
-- Lo chiama lib/pod-addebito.ts. Decisione del committente (15/10/2026): il cliente accetta il costo
-- e paga all'APERTURA della richiesta (app/api/assistenza/apri). Il tasto "Carica POD" e un allegato
-- mandato al cliente in chat la richiamano per le richieste aperte prima di quel giorno e come nuovo
-- tentativo se l'addebito all'apertura non e' riuscito: su una richiesta gia' pagata non fanno niente.
-- Nei ticket di assistenza la chat resta gratuita: il filtro sulla categoria e' qui.
--
-- Perche' nel database e non in due chiamate dall'applicazione: segnare la richiesta e poi scrivere
-- il movimento, con un "togli il segno se il movimento fallisce", lascia due buchi. Se il movimento
-- e' scritto ma la risposta si perde per strada, il segno si toglie e al file successivo il cliente
-- paga due volte; se la funzione muore fra le due, resta "addebitata" senza movimento. Qui o passano
-- entrambi o nessuno. E due chiamate simultanee (apertura + POD, POD + allegato) non passano entrambe:
-- il secondo UPDATE aspetta il primo e non trova piu' pod_addebitato_il vuoto.
--
-- Addebita il MASTER OWNER (chi ha il cliente e il listino POD), non chi la carica in catena, la
-- cifra BLOCCATA all'apertura (tickets.pod_prezzo). Prezzo 0 = gratuita: marcata, nessun movimento.
-- Movimento identico a quello che scriveva la rotta: tipo 'rettifica', "POD <ldv>", riferimento ldv.
-- Ritorna l'importo addebitato (0 se non c'era niente da addebitare).

create or replace function public.addebita_pod(p_ticket_id uuid, p_created_by uuid default null)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  t record;
  v_ldv text;
begin
  update public.tickets
     set pod_addebitato_il = now()
   where id = p_ticket_id
     and categoria = 'pod'
     and cliente_id is not null
     and pod_addebitato_il is null
  returning owner_master_id, cliente_id, spedizione_id, oggetto, pod_prezzo into t;
  if not found then
    return 0;                                      -- gia' addebitata, non e' una POD, o non l'ha aperta un cliente
  end if;
  if coalesce(t.pod_prezzo, 0) <= 0 then
    return 0;                                      -- POD gratuita: marcata evasa, nessun movimento
  end if;
  v_ldv := left(regexp_replace(coalesce(t.oggetto, ''), '^\s+|\s+$', '', 'g'), 40);
  perform public.registra_movimento_cliente(
    t.owner_master_id, t.cliente_id, 'rettifica', 'POD ' || v_ldv, -t.pod_prezzo,
    nullif(v_ldv, ''), t.spedizione_id, p_created_by, false);
  return t.pod_prezzo;
end;
$$;

-- Solo il server (chiave di servizio): un utente non deve poter far partire addebiti da solo.
revoke all on function public.addebita_pod(uuid, uuid) from public, anon, authenticated;
grant execute on function public.addebita_pod(uuid, uuid) to service_role;
