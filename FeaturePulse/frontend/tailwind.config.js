/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: { sans: ['Inter', 'ui-sans-serif', 'system-ui', 'Segoe UI', 'sans-serif'] },
      colors: { brand: { 50: '#eef2ff', 100: '#e0e7ff', 600: '#4f46e5', 700: '#4338ca' } },
    },
  },
  plugins: [],
}
