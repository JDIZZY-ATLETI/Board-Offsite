import type { Rule } from "../../types";
import { I42 } from "./I42";

/**
 * Level 2 registry hook. Phase 2 adds the 41 business rules (architecture section 7.9.3) in the order of
 * section 7.9.4. Only rules with `requiresAriel: false` are executed before the Ariel adapter exists.
 */
export const L2_RULES: Rule[] = [I42];
