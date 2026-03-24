/**
 * Whitelisted user IDs that have full dashboard access.
 * All other authenticated users are redirected to the waitlist.
 *
 * Configure via WHITELISTED_USER_IDS env variable (comma-separated).
 * Example: WHITELISTED_USER_IDS=user_abc123,user_def456,user_ghi789
 */
function getWhitelistedUsers(): Set<string> {
  const ids =
    process.env.WHITELISTED_USER_IDS?.split(",")
      .map((id) => id.trim())
      .filter(Boolean) ?? []
  return new Set(ids)
}

export function isWhitelisted(userId: string): boolean {
  return getWhitelistedUsers().has(userId)
}
