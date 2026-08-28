/**
 * Demo seed script — inserts a few sample products so you can test the
 * Buy Bot / Buy API catalog pagination before adding your real product list.
 *
 * Run with: node src/db/seed.js
 * (Requires the `products` table to already exist — see final combined SQL.)
 */
require('dotenv').config();
const supabase = require('../supabase');

const sampleProducts = [
  { type: 'bot', code: 1, emoji: '✏️', name: 'Typing Bot', price: 0, original_price: null, description: 'Simulates human-like typing in chats.' },
  { type: 'bot', code: 2, emoji: '📸', name: 'Get Profile By Username', price: 0, original_price: null, description: 'Fetch a Telegram profile using just their username.' },
  { type: 'bot', code: 3, emoji: '📊', name: 'Graph Statistics', price: 1, original_price: 4, description: 'Generates visual graphs of your bot/channel stats.' },
  { type: 'api', code: 1, emoji: '🔌', name: 'Live Crypto Price API', price: 2.5, original_price: 5, description: 'Real-time crypto price lookups via REST API.' },
  { type: 'api', code: 2, emoji: '🔗', name: 'Bitly Link Shortener API', price: 2.85, original_price: 3, description: 'Shorten long URLs programmatically.' },
];

async function seed() {
  const { error } = await supabase.from('products').insert(sampleProducts);
  if (error) {
    console.error('Seed failed:', error.message);
  } else {
    console.log(`✅ Seeded ${sampleProducts.length} sample products.`);
  }
}

seed();
