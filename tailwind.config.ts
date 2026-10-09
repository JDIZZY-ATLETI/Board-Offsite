import type { Config } from "tailwindcss";
import forms from "@tailwindcss/forms";
import animate from "tailwindcss-animate";

const hsl = (v: string) => `hsl(var(--${v}) / <alpha-value>)`;

const config: Config = {
  darkMode: ["class"],
  content: ["./src/**/*.{ts,tsx,mdx}"],
  theme: {
    container: { center: true, padding: "1.5rem", screens: { "2xl": "1440px" } },
    extend: {
      colors: {
        background: hsl("background"),
        surface: { DEFAULT: hsl("surface"), raised: hsl("surface-raised") },
        border: hsl("border"),
        ink: { DEFAULT: hsl("ink"), muted: hsl("ink-muted"), faint: hsl("ink-faint") },
        brand: { DEFAULT: hsl("brand"), hover: hsl("brand-hover"), soft: hsl("brand-soft") },
        focus: hsl("focus"),
        sev: {
          file: { DEFAULT: hsl("sev-file"), soft: hsl("sev-file-soft"), text: hsl("sev-file-text") },
          cme: { DEFAULT: hsl("sev-cme"), soft: hsl("sev-cme-soft"), text: hsl("sev-cme-text") },
          warn: { DEFAULT: hsl("sev-warn"), soft: hsl("sev-warn-soft"), text: hsl("sev-warn-text") },
          info: { DEFAULT: hsl("sev-info"), soft: hsl("sev-info-soft"), text: hsl("sev-info-text") },
        },
        ok: { DEFAULT: hsl("ok"), soft: hsl("ok-soft"), text: hsl("ok-text") },
        held: { DEFAULT: hsl("sev-warn"), soft: hsl("sev-warn-soft"), text: hsl("sev-warn-text") },
        rejected: { DEFAULT: hsl("sev-cme"), soft: hsl("sev-cme-soft"), text: hsl("sev-cme-text") },
        verified: { DEFAULT: hsl("ok"), soft: hsl("ok-soft"), text: hsl("ok-text") },
        tampered: { DEFAULT: hsl("tampered"), soft: hsl("tampered-soft"), text: hsl("tampered-text") },
        unverified: hsl("ink-muted"),
        st: {
          transient: hsl("st-transient"),
          attention: hsl("st-attention"),
          ok: hsl("st-ok"),
          bad: hsl("st-bad"),
        },
        diff: {
          del: { DEFAULT: hsl("diff-del"), soft: hsl("diff-del-soft") },
          add: { DEFAULT: hsl("diff-add"), soft: hsl("diff-add-soft") },
          chg: { soft: hsl("diff-chg-soft") },
        },
      },
      fontFamily: {
        sans: ["var(--font-inter)", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["var(--font-jetbrains)", "ui-monospace", "SFMono-Regular", "monospace"],
      },
      fontSize: {
        display: ["1.75rem", { lineHeight: "2.125rem", fontWeight: "600" }],
        h1: ["1.375rem", { lineHeight: "1.75rem", fontWeight: "600" }],
        h2: ["1.125rem", { lineHeight: "1.625rem", fontWeight: "600" }],
        h3: ["0.9375rem", { lineHeight: "1.375rem", fontWeight: "600" }],
        body: ["0.875rem", { lineHeight: "1.25rem" }],
        "body-strong": ["0.875rem", { lineHeight: "1.25rem", fontWeight: "500" }],
        small: ["0.8125rem", { lineHeight: "1.125rem" }],
        caption: ["0.75rem", { lineHeight: "1rem" }],
      },
      borderRadius: {
        sm: "calc(var(--radius) - 4px)",
        md: "var(--radius)",
        lg: "calc(var(--radius) + 4px)",
      },
      boxShadow: {
        card: "0 1px 2px 0 hsl(222 32% 14% / 0.06)",
        pop: "0 8px 24px -8px hsl(222 32% 14% / 0.25)",
      },
      spacing: { sidebar: "15rem", "sidebar-rail": "4rem", topbar: "3.5rem", drawer: "30rem" },
      keyframes: {
        pulseDot: { "0%,100%": { opacity: "1" }, "50%": { opacity: "0.35" } },
      },
      animation: { "pulse-dot": "pulseDot 1.6s ease-in-out infinite" },
    },
  },
  plugins: [forms({ strategy: "class" }), animate],
};
export default config;