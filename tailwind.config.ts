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
    "from-slate-900", "via-violet-900", "to-brand-900",
    "from-emerald-500", "to-teal-600",
    "from-amber-100", "to-rose-50",
    "from-amber-100", "to-amber-50",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
        display: ["Plus Jakarta Sans", "Inter", "sans-serif"],
      },
      colors: {
        // Surfaces (light theme)
        page: "#f6f7fb",
        card: "#ffffff",
        muted: "#f3f4f8",
        border: "#e5e7eb",
        ink: {
          DEFAULT: "#0f172a",
          soft: "#334155",
          mute: "#64748b",
          faint: "#94a3b8",
        },
        brand: {
          50: "#eef2ff",
          100: "#e0e7ff",
          200: "#c7d2fe",
          300: "#a5b4fc",
          400: "#818cf8",
          500: "#6366f1",
          600: "#4f46e5",
          700: "#4338ca",
          800: "#3730a3",
          900: "#312e81",
        },
        accent: {
          gold: "#f59e0b",
          mint: "#10b981",
          rose: "#f43f5e",
          violet: "#8b5cf6",
          sky: "#0ea5e9",
        },
      },
      boxShadow: {
        soft: "0 1px 2px 0 rgb(15 23 42 / 0.04), 0 1px 3px 0 rgb(15 23 42 / 0.06)",
        lift: "0 4px 12px -2px rgb(15 23 42 / 0.08), 0 2px 6px -2px rgb(15 23 42 / 0.05)",
        pop: "0 12px 24px -8px rgb(99 102 241 / 0.25), 0 4px 12px -4px rgb(99 102 241 / 0.15)",
        ring: "0 0 0 4px rgb(99 102 241 / 0.12)",
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
