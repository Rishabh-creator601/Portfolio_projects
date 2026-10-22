/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // Full cyan ramp. The four named stops below are the design-system
        // anchors; the numeric scale exists so borders, tints and hovers can be
        // built from the same hue instead of falling back to grey or slate.
        cyan: {
          50: '#ECFEFF',
          100: '#CFFAFE',
          200: '#A5F3FC',
          300: '#67E8F9',
          400: '#22D3EE',
          500: '#06B6D4',
          600: '#0891B2',
          700: '#0E7490',
          800: '#155E75',
          900: '#164E63',
          950: '#083344',
          deep: '#083344',   // navigation, headers
          brand: '#0E7490',  // primary surfaces and links
          bright: '#06B6D4', // calls to action
          soft: '#ECFEFF',   // tints and hover fills
        },
        // Verdict colours are reserved for compliance outcomes only.
        verdict: {
          pass: '#047857',
          review: '#9A5B08',
          fail: '#A61B1B',
          na: '#64748B',
        },
        surface: {
          DEFAULT: '#FFFFFF',
          muted: '#F6FDFE',
          sunken: '#F8FAFC',
        },
      },
      fontFamily: {
        inter: ['var(--font-inter)', 'Inter', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        card: '0 1px 2px 0 rgba(8, 51, 68, 0.04), 0 1px 6px -1px rgba(8, 51, 68, 0.06)',
        'card-hover': '0 4px 12px -2px rgba(8, 51, 68, 0.12)',
        cyan: '0 8px 24px -8px rgba(6, 182, 212, 0.45)',
      },
      backgroundImage: {
        'cyan-gradient': 'linear-gradient(135deg, #083344 0%, #0E7490 55%, #0891B2 100%)',
        'cyan-sheen': 'linear-gradient(120deg, rgba(6,182,212,0.12) 0%, rgba(8,51,68,0) 60%)',
      },
      keyframes: {
        'fade-in': {
          from: { opacity: '0', transform: 'translateY(4px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        shimmer: {
          '100%': { transform: 'translateX(100%)' },
        },
      },
      animation: {
        'fade-in': 'fade-in 0.2s ease-out',
      },
    },
  },
  plugins: [],
};
