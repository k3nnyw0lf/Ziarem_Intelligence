-- Ziarem RAG: real-time objection handling via pgvector
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS public.sales_objections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  objection_text text NOT NULL,
  rebuttal_text text NOT NULL,
  embedding vector(768),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(objection_text)
);

-- Seed common objections (embeddings backfilled via API or Edge Function)
INSERT INTO public.sales_objections (objection_text, rebuttal_text) VALUES
  ('Rates are too high', 'I hear you. Many buyers feel that way. What we''re seeing in Naples is that waiting often means paying more later—both in price and in rate. Would it help if I showed you what a 0.25% drop could look like if you locked in the right week?'),
  ('I''ll wait until after the holidays', 'Totally get it. The thing is, inventory tends to tighten after the holidays and competition picks up. A lot of our clients use this window to get pre-approved so they can move fast when they see the right place. Want to get that step done now so you''re ready?'),
  ('I already have a title company', 'That makes sense. A lot of folks do. We work with a lot of local title companies here—we can often coordinate with yours so you keep your relationship and still get our network''s speed and support. Want me to see if we can align with them?')
ON CONFLICT (objection_text) DO UPDATE SET rebuttal_text = EXCLUDED.rebuttal_text;

CREATE INDEX IF NOT EXISTS idx_sales_objections_embedding ON public.sales_objections
  USING hnsw (embedding vector_cosine_ops);

ALTER TABLE public.sales_objections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow read for authenticated" ON public.sales_objections
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow service role full access" ON public.sales_objections
  FOR ALL TO service_role USING (true) WITH CHECK (true);

COMMENT ON TABLE public.sales_objections IS 'Ziarem: objection-rebuttal pairs for RAG; embedding for similarity search';

-- RPC for vector similarity search (cosine); used by /api/objection-rebuttal
CREATE OR REPLACE FUNCTION public.match_sales_objections(
  query_embedding text,
  match_threshold float DEFAULT 0.5,
  match_count int DEFAULT 1
)
RETURNS TABLE (rebuttal_text text, similarity float)
LANGUAGE sql
STABLE
AS $$
  SELECT o.rebuttal_text, 1 - (o.embedding <=> query_embedding::vector(768)) AS similarity
  FROM public.sales_objections o
  WHERE o.embedding IS NOT NULL
    AND (1 - (o.embedding <=> query_embedding::vector(768))) >= match_threshold
  ORDER BY o.embedding <=> query_embedding::vector(768)
  LIMIT match_count;
$$;
