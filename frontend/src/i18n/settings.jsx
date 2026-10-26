import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { authApi } from '../api/client'
import { DATE_FORMATS, WEEK_STARTS } from '../utils/locale'

// Настройки профиля (ТЗ «Многоязычность» §3): язык интерфейса, формат даты и
// первый день недели. Хранятся и на сервере (User.*), и в localStorage —
// чтобы страница логина открывалась на нужном языке до авторизации, а
// настройки применялись мгновенно, без ожидания ответа /auth/me.

const LANGUAGE_KEYS = ['ru', 'en']
const DATE_FORMAT_KEYS = DATE_FORMATS.map((f) => f.key)
const WEEK_START_KEYS = WEEK_STARTS

const STORAGE = {
  language: 'language',
  dateFormat: 'dateFormat',
  firstDayOfWeek: 'firstDayOfWeek',
}

function load(key, allowed, fallback) {
  const value = localStorage.getItem(key)
  return allowed.includes(value) ? value : fallback
}

const SettingsContext = createContext(null)

export function SettingsProvider({ children }) {
  const { i18n } = useTranslation()
  const [language, setLanguageState] = useState(() =>
    load(STORAGE.language, LANGUAGE_KEYS, 'ru'),
  )
  const [dateFormat, setDateFormatState] = useState(() =>
    load(STORAGE.dateFormat, DATE_FORMAT_KEYS, 'eu'),
  )
  const [firstDayOfWeek, setFirstDayOfWeekState] = useState(() =>
    load(STORAGE.firstDayOfWeek, WEEK_START_KEYS, 'monday'),
  )

  // Язык живёт в i18next: здесь только синхронизация с выбором пользователя.
  useEffect(() => {
    if (i18n.language !== language) i18n.changeLanguage(language)
  }, [language, i18n])

  // Отправка на сервер — только залогиненным: у анонимного пользователя профиля
  // ещё нет, выбор сохранится в localStorage и уедет на сервер после входа.
  const persist = useCallback((patch) => {
    localStorage.setItem(patch.key, patch.value)
    if (!localStorage.getItem('token')) return
    authApi
      .updateProfile({ [patch.field]: patch.value })
      .catch(() => {}) // локальный выбор уже применён; синхронизируем при следующем входе
  }, [])

  const setLanguage = useCallback(
    (value) => {
      if (!LANGUAGE_KEYS.includes(value)) return
      setLanguageState(value)
      persist({ key: STORAGE.language, field: 'language', value })
    },
    [persist],
  )

  const setDateFormat = useCallback(
    (value) => {
      if (!DATE_FORMAT_KEYS.includes(value)) return
      setDateFormatState(value)
      persist({ key: STORAGE.dateFormat, field: 'date_format', value })
    },
    [persist],
  )

  const setFirstDayOfWeek = useCallback(
    (value) => {
      if (!WEEK_START_KEYS.includes(value)) return
      setFirstDayOfWeekState(value)
      persist({ key: STORAGE.firstDayOfWeek, field: 'first_day_of_week', value })
    },
    [persist],
  )

  // Профиль с сервера — источник истины после входа: применяем его значения.
  // Значений может не быть у старых учёток (до миграции) — такие поля пропускаем.
  const applyProfile = useCallback((profile) => {
    if (!profile) return
    const apply = (value, allowed, key, setter) => {
      if (!allowed.includes(value)) return
      localStorage.setItem(key, value)
      setter(value)
    }
    apply(profile.language, LANGUAGE_KEYS, STORAGE.language, setLanguageState)
    apply(profile.date_format, DATE_FORMAT_KEYS, STORAGE.dateFormat, setDateFormatState)
    apply(
      profile.first_day_of_week,
      WEEK_START_KEYS,
      STORAGE.firstDayOfWeek,
      setFirstDayOfWeekState,
    )
  }, [])

  const value = useMemo(
    () => ({
      language,
      dateFormat,
      firstDayOfWeek,
      setLanguage,
      setDateFormat,
      setFirstDayOfWeek,
      applyProfile,
    }),
    [
      language,
      dateFormat,
      firstDayOfWeek,
      setLanguage,
      setDateFormat,
      setFirstDayOfWeek,
      applyProfile,
    ],
  )

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>
}

export function useSettings() {
  const ctx = useContext(SettingsContext)
  if (!ctx) throw new Error('useSettings must be used within SettingsProvider')
  return ctx
}
