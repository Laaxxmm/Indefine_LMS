// Request validation for /api/firm-os/search. Every message is a plain sentence for the person.
import { z } from "zod";
import { MAX_QUERY, MIN_QUERY, QUERY_MESSAGES, normaliseQuery } from "./query";
import { SEARCH_TYPES } from "./types";

export const SEARCH_MESSAGES = {
  identifierInUrl: "Searches by PAN, GSTIN, phone or email cannot be sent in a web address. Type the full value in the search box and press Enter.",
  identifierInPageAddress: "Searches by PAN, GSTIN, phone or email are not run from the page address. Type the full value in the search box and press Enter.",
  unavailable: "Search is not available right now. Try again in a minute.",
  badType: "Pick one of the listed types, or search all types.",
} as const;

export const searchRequestZ = z.object(
  {
    q: z
      .string({ required_error: QUERY_MESSAGES.tooShort, invalid_type_error: QUERY_MESSAGES.tooShort })
      .transform(normaliseQuery)
      .pipe(z.string().min(MIN_QUERY, QUERY_MESSAGES.tooShort).max(MAX_QUERY, QUERY_MESSAGES.tooLong)),
    type: z.enum(SEARCH_TYPES, { errorMap: () => ({ message: SEARCH_MESSAGES.badType }) }).nullish(),
  },
  { required_error: QUERY_MESSAGES.tooShort, invalid_type_error: QUERY_MESSAGES.tooShort },
);

export type SearchRequest = z.infer<typeof searchRequestZ>;
