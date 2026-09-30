-- Enable the bookmakers used in Ghana (adapters run on sample data until each goes live).
INSERT INTO "bookmakers" ("id", "slug", "name", "country", "website", "is_enabled") VALUES
  (gen_random_uuid(), 'sportybet',   'SportyBet',    'GH', 'https://www.sportybet.com/gh', true),
  (gen_random_uuid(), 'betway',      'Betway',       'GH', 'https://www.betway.com.gh',    true),
  (gen_random_uuid(), '1xbet',       '1xBet',        'GH', 'https://1xbet.com.gh',         true),
  (gen_random_uuid(), 'betpawa',     'betPawa',      'GH', 'https://www.betpawa.com.gh',   true),
  (gen_random_uuid(), 'msport',      'MSport',       'GH', 'https://www.msport.com/gh',    true),
  (gen_random_uuid(), 'footballcom', 'Football.com', 'GH', 'https://www.football.com/gh',  true),
  (gen_random_uuid(), 'betwinner',   'Betwinner',    'GH', 'https://betwinner.com',        true),
  (gen_random_uuid(), '22bet',       '22Bet',        'GH', 'https://22bet.com',            true),
  (gen_random_uuid(), 'paripesa',    'PariPesa',     'GH', 'https://paripesa.com',         true)
ON CONFLICT ("slug") DO UPDATE SET "name" = EXCLUDED."name", "is_enabled" = true;
