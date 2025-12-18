/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./index.html",
    "./script.js",
  ],
  safelist: [
    'fc-today-button',
    'fc-button-prev',
    'fc-button-next',
    'fc-button-primary',
  ],
  darkMode: 'class', // Включаем темный режим через класс
  theme: {
    extend: {
      colors: {
        // Material Design 3 Color Palette - Light Theme
        'md-background': '#F9F9FF',
        'md-container': '#EDEDF4',
        'md-primary': '#415F91',
        'md-on-primary': '#FFFFFF',
        'md-secondary': '#565F71',
        'md-on-secondary': '#FFFFFF',
        'md-primary-container': '#D6E3FF',
        'md-on-primary-container': '#284777',
        'md-secondary-container': '#DAE2F9',
        'md-on-secondary-container': '#3E4759',
        'md-tertiary': '#705575',
        'md-on-tertiary': '#FFFFFF',
        'md-tertiary-container': '#FAD8FD',
        'md-on-tertiary-container': '#573E5C',
        'md-error': '#BA1A1A',
        'md-on-error': '#FFFFFF',
        'md-error-container': '#FFDAD6',
        'md-on-error-container': '#93000A',
        'md-surface': '#F9F9FF',
        'md-on-surface': '#191C20',
        'md-surface-variant': '#E0E2EC',
        'md-on-surface-variant': '#44474E',
        'md-outline': '#74777F',
        'md-outline-variant': '#C4C6D0',
        'md-surface-container': '#EDEDF4',
        'md-surface-container-high': '#E7E8EE',
        'md-surface-container-highest': '#E2E2E9',
      },
      fontFamily: {
        'roboto': ['Roboto', 'sans-serif'],
      },
      borderRadius: {
        'md': '12px',
        'md-lg': '16px',
        'md-xl': '24px',
        'md-2xl': '28px',
      },
      boxShadow: {
        'md-sm': '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
        'md': '0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px -1px rgba(0, 0, 0, 0.1)',
        'md-md': '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -2px rgba(0, 0, 0, 0.1)',
        'md-lg': '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -4px rgba(0, 0, 0, 0.1)',
        'md-xl': '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)',
      },
    },
  },
  plugins: [
    function({ addBase, theme }) {
      addBase({
        // Dark High Contrast Theme Colors
        '.dark': {
          '--md-background': '#111318',
          '--md-container': '#2E3036',
          '--md-primary': '#EBF0FF',
          '--md-on-primary': '#000000',
          '--md-secondary': '#EBF0FF',
          '--md-on-secondary': '#000000',
          '--md-primary-container': '#A6C3FC',
          '--md-on-primary-container': '#000B20',
          '--md-secondary-container': '#BAC3D8',
          '--md-on-secondary-container': '#030B1A',
          '--md-tertiary': '#FFE9FF',
          '--md-on-tertiary': '#000000',
          '--md-tertiary-container': '#D8B8DC',
          '--md-on-tertiary-container': '#16041D',
          '--md-error': '#FFECE9',
          '--md-on-error': '#000000',
          '--md-error-container': '#FFAEA4',
          '--md-on-error-container': '#220001',
          '--md-surface': '#111318',
          '--md-on-surface': '#FFFFFF',
          '--md-surface-variant': '#44474E',
          '--md-on-surface-variant': '#FFFFFF',
          '--md-outline': '#EEEFF9',
          '--md-outline-variant': '#C0C2CC',
          '--md-surface-container': '#2E3036',
          '--md-surface-container-high': '#393B41',
          '--md-surface-container-highest': '#45474C',
        },
      });
    },
  ],
}

