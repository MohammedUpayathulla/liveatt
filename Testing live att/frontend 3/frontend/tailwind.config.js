/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './src/**/*.{js,jsx}',
    './index.html',
  ],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      colors: {
        'app-bg': '#0f172a',
        'app-card': '#1e293b',
      },
    },
  },
  plugins: [],
};
