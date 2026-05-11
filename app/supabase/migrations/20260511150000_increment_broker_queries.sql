-- Migration: increment_broker_queries
-- Date: 2026-05-11
-- Context: WhatsApp handler was doing read-then-write on brokers.queries_today,
-- which loses counts under concurrent messages. This RPC makes the increment
-- atomic and returns the new value.

CREATE OR REPLACE FUNCTION public.increment_broker_queries(p_broker_id uuid)
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE brokers
  SET queries_today = queries_today + 1
  WHERE id = p_broker_id
  RETURNING queries_today;
$$;

REVOKE ALL ON FUNCTION public.increment_broker_queries(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.increment_broker_queries(uuid) TO service_role;
