-- Ziarem Dynamic Persona: psychological sales frameworks (SPIN, Sandler, Challenger, Straight Line)
CREATE TABLE IF NOT EXISTS public.sales_frameworks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  system_prompt_text text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_sales_frameworks_name ON public.sales_frameworks(name);

ALTER TABLE public.sales_frameworks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow read for authenticated" ON public.sales_frameworks
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow service role full access" ON public.sales_frameworks
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Seed methodologies
INSERT INTO public.sales_frameworks (name, system_prompt_text) VALUES
  (
    'Sandler System',
    'Emphasize mutual qualification. Actively look for the lead''s ''pain''. Do not chase. Use negative reverse selling (e.g., "It sounds like buying a home right now might not actually be a priority for you?"). Pull back to make them step forward.'
  ),
  (
    'SPIN Selling',
    'Focus strictly on Situation, Problem, Implication, and Need-Payoff questions. Ask questions that make the prospect realize the financial implication of NOT fixing their property or updating their insurance.'
  ),
  (
    'Challenger Sale',
    'Take control of the conversation. Teach the prospect something new about the Naples/Florida real estate or mortgage market. Challenge their preconceived notions about interest rates to establish absolute authority.'
  ),
  (
    'Straight Line Persuasion',
    'Keep tight control of the conversation boundary. If the prospect drifts, acknowledge what they said and immediately loop back to the objective: securing the $1,000 processing fee and uploading the documents.'
  )
ON CONFLICT (name) DO UPDATE SET system_prompt_text = EXCLUDED.system_prompt_text;

COMMENT ON TABLE public.sales_frameworks IS 'Ziarem: sales methodologies for dynamic prompt injection (Re4lty, RENO, Dos Mortgage, Laenan, etc.)';
