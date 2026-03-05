-- Seed companies per business verticals (Re4lty, RENO, Dos Mortgage, Laenan, Closed By Whom?, Wolf Insurance)
INSERT INTO public.companies (id, name, vertical, is_partner, active_status) VALUES
  ('a0000001-0001-4000-8000-000000000001'::uuid, 'Re4lty Inc.', 'Re4lty Inc.', false, true),
  ('a0000002-0002-4000-8000-000000000002'::uuid, 'RENO LLC', 'RENO LLC', false, true),
  ('a0000003-0003-4000-8000-000000000003'::uuid, 'Dos Mortgage LLC', 'Dos Mortgage LLC', true, true),
  ('a0000004-0004-4000-8000-000000000004'::uuid, 'Laenan', 'Laenan', false, true),
  ('a0000005-0005-4000-8000-000000000005'::uuid, 'Closed By Whom?', 'Closed By Whom?', false, true),
  ('a0000006-0006-4000-8000-000000000006'::uuid, 'Wolf Insurance', 'Wolf Insurance', false, true)
ON CONFLICT (id) DO NOTHING;
