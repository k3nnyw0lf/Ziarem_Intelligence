-- Ziarem Dynamic Persona: cultural/regional linguistic modules
CREATE TABLE IF NOT EXISTS public.cultural_matrices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  region text NOT NULL,
  language text NOT NULL,
  tone text NOT NULL,
  system_prompt_text text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(region, language)
);

CREATE INDEX idx_cultural_matrices_region_lang ON public.cultural_matrices(region, language);

ALTER TABLE public.cultural_matrices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow read for authenticated" ON public.cultural_matrices
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow service role full access" ON public.cultural_matrices
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Seed linguistic modules
INSERT INTO public.cultural_matrices (region, language, tone, system_prompt_text) VALUES
  (
    'Florida Gulf Coast / Naples',
    'EN',
    'Professional, relaxed, highly respectful',
    'Tone: Professional, relaxed, highly respectful. Pace: Moderate. Vocabulary: Emphasize wealth preservation, equity, and lifestyle.'
  ),
  (
    'Miami / Caribbean',
    'ES',
    'Warm, highly energetic, relational',
    'Tone: Warm, highly energetic, relational. Pace: Fast. Vocabulary: Use colloquial Caribbean Spanish phrasing where appropriate to build instant rapport and trust. Drop extreme formality in favor of strong, familiar confidence.'
  ),
  (
    'Standard Latin America',
    'ES',
    'Polite, formal, deferential',
    'Tone: Polite, formal, deferential. Pace: Moderate. Vocabulary: Use ''Usted'' until invited otherwise. Highly structured and respectful.'
  )
ON CONFLICT (region, language) DO UPDATE SET tone = EXCLUDED.tone, system_prompt_text = EXCLUDED.system_prompt_text;

COMMENT ON TABLE public.cultural_matrices IS 'Ziarem: regional/language tone and vocabulary for dynamic prompt injection';
