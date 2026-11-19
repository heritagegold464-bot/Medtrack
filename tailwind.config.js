/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        navy: { 50: '#eef3f9', 100: '#dbe5f1', 200: '#b7cbe3', 600: '#1d4373', 700: '#163659', 800: '#0f2a4a', 900: '#0a1d35' },
        ok: { 50: '#e8f6f4', 100: '#c9ebe6', 600: '#0f8b7d', 700: '#0b6e63' },
        warn: { 50: '#fff6e0', 100: '#ffe9b3', 600: '#b97800', 700: '#8f5d00' },
        bad: { 50: '#fdecec', 100: '#f9cccc', 600: '#c62828', 700: '#9f1f1f' },
        ink: { 500: '#5b6b7f', 700: '#2b3a4d', 900: '#142033' },
        surface: '#f5f7fa',
      },
      fontFamily: { sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'] },
    },
  },
  plugins: [],
};
