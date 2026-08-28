/**
 * State Manager
 * -------------
 * Tracks "waiting for user input" states — e.g. after clicking "Paid",
 * the bot waits for the user's next TEXT message (Transaction ID) instead
 * of a button click.
 *
 * In-memory for now (Map). Will move to Supabase/Redis for persistence
 * across restarts once we finalize all features.
 */

const states = new Map(); // telegram_id -> { step, data, messageId }

function setState(userId, step, data = {}, messageId = null) {
  states.set(userId, { step, data, messageId });
}

function getState(userId) {
  return states.get(userId);
}

function clearState(userId) {
  states.delete(userId);
}

module.exports = { setState, getState, clearState };
