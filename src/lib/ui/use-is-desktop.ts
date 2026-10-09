"use client";

import * as React from "react";

export const DESKTOP_MIN_WIDTH = 1024;
/** Copy for controls disabled below the desktop breakpoint (docs/ux-design.md D12 / section 8.3). */
export const DESKTOP_ONLY_NOTE = `Use a desktop browser (\u2265 ${DESKTOP_MIN_WIDTH} px) for this action`;

/**
 * True at >= 1024 px (ux-design D12: below that the app is read-only). Starts as `true` so server and
 * first client render agree; the real value lands after hydration.
 */
export function useIsDesktop(): boolean {
  const [desktop, setDesktop] = React.useState(true);
  React.useEffect(() => {
    const mq = window.matchMedia(`(min-width: ${DESKTOP_MIN_WIDTH}px)`);
    const update = () => setDesktop(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return desktop;
}
