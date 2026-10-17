/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        /* Матовые карточки на тёмно-синем фоне (#35506b):
           сплошной светло-серо-голубой вместо прозрачного белого.
           Значение = белый 90% поверх #35506b (бывший эффект rgba(255,255,255,.9)). */
        card: {
          DEFAULT: '#ebeef0', // фон карточек/панелей на тёмном фоне
          hover: '#f3f5f7',   // чуть светлее при наведении
        },
      },
    },
  },
  plugins: [],
}
