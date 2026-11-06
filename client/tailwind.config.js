/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        theme: {
          bg: '#F4F6F8',
          sidebar: '#252F3B',
          card: '#FFFFFF',
          'bg-secondary': '#E8EDF2',
          primary: '#789CB8',
          secondary: '#B6CAD9',
          heading: '#27313D',
          border: '#D9E0E7',
        },
        emergency: {
          critical: '#DC4545',
          high: '#E89543',
          medium: '#D5B34F',
          available: '#56866B',
          dispatched: '#5685B5',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
