/**
 * Whitelisted user IDs that have full dashboard access.
 * All other authenticated users are redirected to the waitlist.
 */
export const WHITELISTED_USERS = new Set([
  "user_3BKOean8C5EP0Qaoy6JgPJtcy2X",
  "user_3BHxI4nkF6RunBeLRwEs7iY6nIH",
  "user_3BHR5qswQ5V3hewWuoo4NvzXJgn",
])

export function isWhitelisted(userId: string): boolean {
  return WHITELISTED_USERS.has(userId)
}
