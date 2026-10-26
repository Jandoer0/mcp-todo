import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'

import ru from './locales/ru.json'
import en from './locales/en.json'

export const LANGUAGES = [
  { code: 'ru', label: 'Русский' },
  { code: 'en', label: 'English' },
]

// Язык по умолчанию берём из сохранённого выбора: страница логина тоже должна
// открываться на языке пользователя, а профиль загружается только после входа.
export function getInitialLanguage() {
  const saved = localStorage.getItem('language')
  return saved === 'ru' || saved === 'en' ? saved : 'ru'
}

i18n.use(initReactI18next).init({
  resources: {
    ru: { translation: ru },
    en: { translation: en },
  },
  lng: getInitialLanguage(),
  fallbackLng: 'ru',
  // React экранирует значения сам, поэтому в словарях можно писать JSX-безопасный текст.
  interpolation: { escapeValue: false },
  returnEmptyString: false,
})

export default i18n
