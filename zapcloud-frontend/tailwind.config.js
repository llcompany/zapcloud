/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        zap: {
          primary: '#25D366',
          dark:    '#128C7E',
          darker:  '#075E54',
          bubble:  '#DCF8C6',
          bg:      '#F0F2F5',
        },
      },
    },
  },
  plugins: [],
}
