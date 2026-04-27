import type { Config } from "tailwindcss";

export default {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
      },
      colors: {
        bg: {
          DEFAULT: "#0a0e1a",
          soft: "#0f1424",
          card: "#141b2e",
          elev: "#1a2238",
        },
        brand: {
          50: "#eef4ff",
          100: "#dde7ff",
          200: "#bccfff",
          300: "#8eaaff",
          400: "#5d80ff",
          500: "#3b62f6",
          600: "#2a4ae0",
          700: "#243bb6",
          800: "#1f308f",
          900: "#1d2c70",
        },
        accent: {
          gold: "#fbbf24",
          mint: "#10b981",
          rose: "#f43f5e",
          violet: "#8b5cf6",
        },
      },
      boxShadow: {
        glow: "0 0 0 1px rgba(255,255,255,0.05), 0 8px 32px -8px rgba(59,98,246,0.4)",
        "glow-gold":
          "0 0 0 1px rgba(255,255,255,0.05), 0 8px 32px -8px rgba(251,191,36,0.5)",
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
