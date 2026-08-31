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

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

module.exports = supabase;
