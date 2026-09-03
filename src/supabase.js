const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const { SUPABASE_URL, SUPABASE_KEY } = process.env;

// Fail with a clear, actionable message instead of a cryptic stack trace
// when the .env file is missing or has placeholder/invalid values.
if (!SUPABASE_URL || !SUPABASE_KEY || !/^https?:\/\//i.test(SUPABASE_URL)) {
  console.error(
    '\n❌ Supabase config missing/invalid.\n' +
    '   Project root mein ek ".env" file banao (".env.example" ko copy karke)\n' +
    '   aur usme apne asli Supabase Project URL + service_role key daalo:\n\n' +
    '   SUPABASE_URL=https://xxxxx.supabase.co\n' +
    '   SUPABASE_KEY=your_service_role_key\n\n' +
    '   Yeh Supabase dashboard → Project Settings → API mein milega.\n'
  );
  process.exit(1);
}

// FIX: "bot sometimes doesn't reply at all" — the Supabase client used the
// default fetch with NO timeout. If a single DB request ever stalled (slow
// network, brief Supabase hiccup, DNS blip), that `await supabase...` call
// would hang forever — not error out, just hang — so the surrounding
// try/catch never fired and the user got total silence with no fallback
// message. Every handler in this bot awaits Supabase before replying, so
// this one missing timeout was capable of freezing any single interaction.
// Fix: wrap fetch with a 12s timeout so a stuck request fails fast and lets
// the existing try/catch blocks show an error message instead of hanging.
const FETCH_TIMEOUT_MS = 12000;
function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  global: { fetch: fetchWithTimeout },
});

module.exports = supabase;
