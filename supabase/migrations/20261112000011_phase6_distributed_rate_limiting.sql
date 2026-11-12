-- =============================================================================
-- UjianKita Phase 6: Distributed Serverless Rate-Limiting Store
-- Eliminates multi-instance Vercel cold-start memory isolation and fixes the
-- school Wi-Fi NAT shared-IP login bottleneck by tracking distributed counters
-- in PostgreSQL (zero extra paid services, default-deny RLS).
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.api_rate_limits (
  bucket_key text PRIMARY KEY,
  window_started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  window_ms integer NOT NULL CHECK (window_ms >= 1000 AND window_ms <= 86400000),
  request_count integer NOT NULL DEFAULT 0 CHECK (request_count >= 0),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX IF NOT EXISTS idx_api_rate_limits_updated_at
  ON public.api_rate_limits (updated_at);

ALTER TABLE public.api_rate_limits ENABLE ROW LEVEL SECURITY;

-- Zero client policies: table is accessible strictly via SECURITY DEFINER RPCs
-- restricted to service_role.

CREATE OR REPLACE FUNCTION public.consume_rate_limit(
  p_bucket_key text,
  p_limit integer,
  p_window_ms integer,
  p_increment boolean DEFAULT true
)
RETURNS TABLE (
  allowed boolean,
  remaining integer,
  retry_after_seconds integer,
  current_count integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_window_start timestamptz;
  v_stored_window_ms integer;
  v_count integer;
  v_window_end timestamptz;
BEGIN
  IF p_bucket_key IS NULL OR length(trim(p_bucket_key)) = 0 OR length(p_bucket_key) > 256 THEN
    RAISE EXCEPTION 'INVALID_BUCKET_KEY';
  END IF;
  IF p_limit IS NULL OR p_limit < 1 THEN
    RAISE EXCEPTION 'INVALID_RATE_LIMIT';
  END IF;
  IF p_window_ms IS NULL OR p_window_ms < 1000 OR p_window_ms > 86400000 THEN
    RAISE EXCEPTION 'INVALID_WINDOW_MS';
  END IF;

  INSERT INTO public.api_rate_limits (bucket_key, window_started_at, window_ms, request_count, updated_at)
  VALUES (p_bucket_key, v_now, p_window_ms, 0, v_now)
  ON CONFLICT (bucket_key) DO NOTHING;

  SELECT r.window_started_at, r.window_ms, r.request_count
  INTO v_window_start, v_stored_window_ms, v_count
  FROM public.api_rate_limits r
  WHERE r.bucket_key = p_bucket_key
  FOR UPDATE;

  v_window_end := v_window_start + ((LEAST(v_stored_window_ms, p_window_ms))::double precision * interval '1 millisecond');

  -- Reset counter once sliding/fixed bucket window has elapsed
  IF v_window_end <= v_now THEN
    v_window_start := v_now;
    v_count := CASE WHEN p_increment THEN 1 ELSE 0 END;

    UPDATE public.api_rate_limits
    SET window_started_at = v_window_start,
        window_ms = p_window_ms,
        request_count = v_count,
        updated_at = v_now
    WHERE bucket_key = p_bucket_key;

    RETURN QUERY SELECT true, GREATEST(0, p_limit - v_count), 0, v_count;
    RETURN;
  END IF;

  -- Active window already exhausted
  IF v_count >= p_limit THEN
    RETURN QUERY
    SELECT
      false,
      0,
      GREATEST(1, CEIL(EXTRACT(EPOCH FROM (v_window_end - v_now)))::integer),
      v_count;
    RETURN;
  END IF;

  IF p_increment THEN
    v_count := v_count + 1;
    UPDATE public.api_rate_limits
    SET request_count = v_count,
        window_ms = p_window_ms,
        updated_at = v_now
    WHERE bucket_key = p_bucket_key;
  END IF;

  -- Opportunistic bounded purge of expired entries older than 2 hours
  IF random() < 0.02 THEN
    DELETE FROM public.api_rate_limits
    WHERE updated_at < v_now - interval '2 hours';
  END IF;

  RETURN QUERY SELECT true, GREATEST(0, p_limit - v_count), 0, v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.reset_rate_limit_bucket(
  p_bucket_key text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_bucket_key IS NULL OR length(trim(p_bucket_key)) = 0 THEN
    RETURN;
  END IF;

  DELETE FROM public.api_rate_limits
  WHERE bucket_key = p_bucket_key;
END;
$$;

REVOKE ALL ON TABLE public.api_rate_limits FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.consume_rate_limit(text, integer, integer, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reset_rate_limit_bucket(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_rate_limit(text, integer, integer, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.reset_rate_limit_bucket(text) TO service_role;
