import type { Config } from "tailwindcss";

export default {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  // Recap slide gradients are passed as runtime string props to <SlideShell>.
  // Tailwind's JIT scanner usually picks them up because the literals do
  // appear in source, but we safelist explicitly so they can never be
  // accidentally tree-shaken from a stale build cache.
  safelist: [
    "bg-gradient-to-br",
    "from-brand-500", "via-violet-500", "to-rose-500",
    "from-cyan-500", "to-brand-600",
    "from-indigo-600", "via-violet-600", "to-purple-700",
    "from-orange-500", "via-rose-500", "to-pink-600",
    "from-emerald-500", "to-teal-700",
    "from-rose-500", "to-amber-500",
    "from-pink-500", "to-red-600",
    "from-violet-600", "to-fuchsia-600",
    "from-amber-400", "via-orange-500",
    "from-slate-900", "via-violet-900", "to-brand-900", "to-rose-900",
    "from-emerald-500", "to-teal-600",
    "from-amber-100", "to-rose-50",
    "from-amber-100", "to-amber-50",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Plus Jakarta Sans", "ui-sans-serif", "system-ui", "sans-serif"],
        display: ["Schibsted Grotesk", "Plus Jakarta Sans", "sans-serif"],
      },
      colors: {
        // Surfaces — Indefine 2.0 brand
        page: "#f5f5fb",
        card: "#ffffff",
        muted: "#f1f0f7",
        border: "#ececf3",
        ink: {
          DEFAULT: "#15132b",
          soft: "#3a3852",
          mute: "#6c6a82",
          faint: "#b7b5c6",
        },
        brand: {
          50: "#eeebff", // brand-soft
          100: "#e0dbff",
          200: "#c7befb",
          300: "#a99cf5",
          400: "#8a6bf5",
          500: "#5b4be6", // brand
          600: "#4b37d8", // brand-ink
          700: "#3d2cb8",
          800: "#2f2196",
          900: "#241a72",
        },
        accent: {
          coral: "#ff6b4a",
          gold: "#ffb020",
          mint: "#17b978",
          rose: "#f43f5e",
          violet: "#8b5cf6",
          sky: "#0ea5e9",
        },
      },
      boxShadow: {
        soft: "0 1px 2px 0 rgb(20 19 43 / 0.04), 0 1px 3px 0 rgb(20 19 43 / 0.06)",
        lift: "0 10px 30px -18px rgb(20 19 43 / 0.25)",
        pop: "0 12px 24px -8px rgb(91 75 230 / 0.28), 0 4px 12px -4px rgb(91 75 230 / 0.18)",
        ring: "0 0 0 4px rgb(91 75 230 / 0.14)",
      },
      backgroundImage: {
        "grid-faint":
          "linear-gradient(to right, rgb(15 23 42 / 0.04) 1px, transparent 1px), linear-gradient(to bottom, rgb(15 23 42 / 0.04) 1px, transparent 1px)",
      },
      animation: {
        "fade-in": "fadeIn 0.4s ease-out",
        "slide-up": "slideUp 0.5s ease-out",
        "pulse-soft": "pulseSoft 2s ease-in-out infinite",
        "shimmer": "shimmer 2s linear infinite",
      },
      keyframes: {
        fadeIn: {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        slideUp: {
          "0%": { opacity: "0", transform: "translateY(8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        pulseSoft: {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.6" },
        },
        shimmer: {
          "0%": { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
      },
    },
  },
  plugins: [],
} satisfies Config;
