const supabase = require('../supabase');
const { get, set, invalidate, TTL } = require('./cache');

/**
 * Returns 'owner' | 'admin' | null depending on the user's role.
 * Result is cached for 10 minutes to avoid a DB hit on every admin action.
 * Call invalidateAdminCache(telegramId) after add/remove admin operations.
 */
async function getAdminRole(telegramId) {
  const cacheKey = `admin_role:${telegramId}`;
  const cached = get(cacheKey);
  if (cached !== undefined) return cached; // null is a valid cached value

  const { data, error } = await supabase
    .from('admins')
    .select('role')
    .eq('telegram_id', telegramId)
    .maybeSingle();

  if (error) {
    console.error('Admin role check error:', error.message);
    return null;
  }

  const role = data ? data.role : null;
  set(cacheKey, role, TTL.ADMIN_ROLE);
  return role;
}

async function isOwner(telegramId) {
  return (await getAdminRole(telegramId)) === 'owner';
}

/**
 * Call this after adding or removing an admin so the cache is refreshed.
 */
function invalidateAdminCache(telegramId) {
  invalidate(`admin_role:${telegramId}`);
}

module.exports = { getAdminRole, isOwner, invalidateAdminCache };
