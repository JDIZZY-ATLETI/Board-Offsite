/**
 * Request headers that carry a dev identity. Edge-safe (no Node imports) so `middleware.ts` can share it.
 * The middleware strips every one of these from inbound requests before bridging the dev cookie, so a
 * route handler only ever sees values the middleware itself set.
 */
export const IDENTITY_HEADERS = ["x-user-id", "x-user-role", "x-role", "x-employer-id"] as const;
