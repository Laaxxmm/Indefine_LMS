// Every sentence the companion API or the /companion page can show a person. Plain words: what is
// wrong and what to do. No status codes or internal names in the text — the side panel shows
// these as they are.
import { COMPANION_LABEL_MAX, COMPANION_MAX_ACTIVE_TOKENS } from "./config";

export const MSG = {
  tokenMissing: "No pairing token was sent. Paste your token on the companion's Options page.",
  tokenUnknown:
    "Firm OS does not recognise this pairing token. Check that you pasted all of it, or create a new one on the Companion page in Firm OS.",
  tokenRevoked: "This pairing was revoked. Create a new one on the Companion page in Firm OS.",
  tokenExpired: "Your pairing has expired. Create a new one on the Companion page in Firm OS.",
  accountInactive: "Your Firm OS account is not active. Ask an admin if you think this is wrong.",
  noAccess: "The Companion is not turned on for your account. Ask an admin to turn it on in Firm OS.",
  rateLimited: "Too many refreshes in a short time. Wait a minute, then try again.",
  wrongOrigin: "This address only answers the Firm OS Companion extension.",
  serverError: "Firm OS could not load your task just now. Try again in a minute.",
  caughtUp: "You're all caught up.",
  signedOut: "Sign in to Firm OS first.",
  labelRequired: "Give the pairing a name, such as the computer it is for.",
  labelTooLong: `Keep the name to ${COMPANION_LABEL_MAX} characters or fewer.`,
  tooManyActive: `You already have ${COMPANION_MAX_ACTIVE_TOKENS} active pairings. Revoke one you no longer use, then create a new one.`,
  pairingNotFound: "That pairing was not found. Reload the page to see your current pairings.",
  badRequest: "Something in the request was not understood. Reload the page and try again.",
  saveFailed: "Firm OS could not save that just now. Try again in a minute.",
  unreachable: "Firm OS could not be reached. Check your connection and try again.",
} as const;
