import type { Rule } from "../../types";
import { B2 } from "./B2";
import { B5 } from "./B5";
import { B19 } from "./B19";
import { B19b } from "./B19b";
import { B22 } from "./B22";
import { B31 } from "./B31";
import { B33 } from "./B33";
import { B37 } from "./B37";
import { B38 } from "./B38";
import { B40 } from "./B40";
import { B41 } from "./B41";
import { B43 } from "./B43";
import { B44 } from "./B44";
import { B47 } from "./B47";
import { B53a } from "./B53a";
import { B53b } from "./B53b";
import { B109 } from "./B109";
import { B112 } from "./B112";
import { B113 } from "./B113";
import { B139 } from "./B139";
import { B181 } from "./B181";
import { B182 } from "./B182";
import { B184a } from "./B184a";
import { B184b } from "./B184b";
import { B184c } from "./B184c";
import { B185 } from "./B185";
import { B186a } from "./B186a";
import { B186b } from "./B186b";
import { B186c } from "./B186c";
import { B192a } from "./B192a";
import { B192b } from "./B192b";
import { B202 } from "./B202";
import { B203 } from "./B203";
import { B204 } from "./B204";
import { B205 } from "./B205";
import { B206 } from "./B206";
import { B207 } from "./B207";
import { B214 } from "./B214";
import { B223 } from "./B223";
import { B224 } from "./B224";
import { I42 } from "./I42";

/** Level 2 business rules in the deterministic order of architecture section 7.9.4. */
export const L2_RULES: Rule[] = [
  B2, B204, B224, B5, B223, B109, I42, B112, B113, B139, B192a, B192b, B22, B19, B19b, B31, B33, B37, B38,
  B184a, B184b, B184c, B185, B186a, B186b, B186c, B53a, B53b, B181, B182, B40, B41, B43, B44, B47, B214,
  B207, B203, B205, B206, B202,
];