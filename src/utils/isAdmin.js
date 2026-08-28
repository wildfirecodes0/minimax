const supabase = require('../supabase');

/**
 * Returns 'owner' | 'admin' | null depending on the user's role.
 */
async function getAdminRole(telegramId) {
  const { data, error } = await supabase
    .from('admins')
    .select('role')
    .eq('telegram_id', telegramId)
    .maybeSingle();

  if (error) {
    console.error('Admin role check error:', error.message);
    return null;
  }
  return data ? data.role : null;
}

async function isOwner(telegramId) {
  return (await getAdminRole(telegramId)) === 'owner';
}

module.exports = { getAdminRole, isOwner };
