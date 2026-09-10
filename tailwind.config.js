/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        card: "hsl(var(--card))",
        "card-foreground": "hsl(var(--card-foreground))",
        popover: "hsl(var(--popover))",
        "popover-foreground": "hsl(var(--popover-foreground))",
        primary: "hsl(var(--primary))",
        "primary-foreground": "hsl(var(--primary-foreground))",
        secondary: "hsl(var(--secondary))",
        "secondary-foreground": "hsl(var(--secondary-foreground))",
        muted: "hsl(var(--muted))",
        "muted-foreground": "hsl(var(--muted-foreground))",
        accent: "hsl(var(--accent))",
        "accent-foreground": "hsl(var(--accent-foreground))",
        destructive: "hsl(var(--destructive))",
        "destructive-foreground": "hsl(var(--destructive-foreground))",
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        // Per-tab accent palette — variables are swapped at runtime when the
        // active tab changes (see src/utils/theme.ts)
        theme: {
          200: "rgb(var(--theme-200) / <alpha-value>)",
          300: "rgb(var(--theme-300) / <alpha-value>)",
          400: "rgb(var(--theme-400) / <alpha-value>)",
          500: "rgb(var(--theme-500) / <alpha-value>)",
          600: "rgb(var(--theme-600) / <alpha-value>)",
          700: "rgb(var(--theme-700) / <alpha-value>)",
          900: "rgb(var(--theme-900) / <alpha-value>)",
        },
      }
    },
  },
  plugins: [],
}
