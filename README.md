# OmniTask MCP

Веб-приложение для управления задачами со встроенным MCP-сервером для ИИ-агентов.

- **Бэкенд**: FastAPI + SQLAlchemy (SQLite), JWT-аутентификация — по адресу `/api`
- **Фронтенд**: React + Vite + Tailwind — собирается в `dist/` и отдаётся как статические файлы
- **MCP**: FastMCP через SSE — по адресам `/sse` и `/messages`

## Возможности

- Регистрация / вход, роли (пользователь / администратор). Первый зарегистрированный пользователь становится администратором.
- Канбан-доска с вертикальными группами по спискам (сворачиваемыми), системные списки «Не начато», «В работе», «Готово», «Архив» и пользовательские списки с цветами и порядком сортировки.
- Задачи: приоритет (цветная точка), статус, даты начала/завершения, описание с Markdown, теги (18 цветных пресетов), блокирующие задачи.
- Фильтры дашборда: «Всего задач», «К выполнению», «В работе», «Выполнено», «Просрочено», «Запланировано»; облако тегов. На мобильных фильтры — выпадающее меню.
- Циклические задачи: умная видимость (окно `reminder_days`), интервалы (ежедневно/еженедельно/ежемесячно/ежегодно), кнопки «Выполнено / Пропустить / Остановить / История», история итераций в `task_cycle_logs`.
- Панель администратора: управление пользователями, роли, разрешение регистрации, генерация/отзыв MCP-токенов.
- Адаптивный интерфейс (мобильные: bottom-sheet модалки, компактные кнопки).

## REST API (кратко)

| Домен | Эндпоинты |
|---|---|
| Аутентификация | `GET /api/auth/registration-status`, `POST /api/auth/register`, `POST /api/auth/login` |
| Задачи | CRUD `/api/tasks`, `POST /api/tasks/bulk` (массовое обновление), `POST /api/tasks/{id}/cycle/skip`, `POST /api/tasks/{id}/cycle/stop`, `GET /api/tasks/{id}/cycle/history` |
| Списки и теги | CRUD `/api/lists`, CRUD `/api/tags` |
| Статистика | `GET /api/summary` |
| Администрирование | `GET/PUT /api/admin/settings/...`, CRUD `/api/admin/users`, `POST/DELETE /api/admin/users/{id}/mcp-token` |
| Диагностика | `GET /api/health` (статус + версия сборки) |

Даты передаются в формате ISO 8601. Все запросы к задачам ограничены текущим пользователем (JWT в заголовке `Authorization: Bearer ***`).

## MCP-инструменты

Все инструменты принимают `auth_token` первым аргументом (MCP-токен генерируется в панели администратора):

- `list_tasks`, `create_task`, `update_task`, `delete_task` — управление задачами (включая циклические поля)
- `search_tasks` — поиск по названию/описанию
- `manage_cycle` — управление циклом: `done` / `skip` / `stop`
- `get_project_summary` — сводная статистика
- `get_my_profile` — ID и роль текущего пользователя
- `list_all_lists` — список всех списков задач

## Локальная разработка

```bash
./scripts/dev.sh
```

Бэкенд на `:8000`, dev-сервер фронтенда на `:5173` (с прокси к API).

## Деплой

- Образ собирается в `ghcr.io/jandoer0/mcp-todo:latest`.
- Развёртывание: хост `podman-svc`, управление через **Podman Quadlet** (systemd-юнит `infra/mcp-todo.container`), прокси — Caddy.
- Обновление: `podman pull` + `systemctl --user restart mcp-todo.service`.
- Фронтенд автоматически перезагружается при изменении версии бэкенда (`BUILD_VERSION`), ручная очистка кэша не требуется.

```bash
# Сборка и публикация образа
echo $(cat /home/agent/.ghcr_token) | podman login ghcr.io -u Jandoer0 --password-stdin
podman build -t ghcr.io/jandoer0/mcp-todo:latest .
podman push ghcr.io/jandoer0/mcp-todo:latest

# Обновление на сервере
ssh podman-svc "podman pull ghcr.io/jandoer0/mcp-todo:latest && systemctl --user restart mcp-todo.service"
```

## Планы развития

- Этап устранения ошибок в коде.
- PWA (Progressive Web App): `vite-plugin-pwa`, `manifest.json`, Service Workers — установка сайта как приложения (Standalone mode).
