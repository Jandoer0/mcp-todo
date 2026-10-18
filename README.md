# OmniTask MCP

<p align="center">
  <img src="frontend/public/logo.png" alt="OmniTask" width="140" />
</p>

Веб-приложение для управления задачами со встроенным MCP-сервером для ИИ-агентов.

- **Бэкенд**: FastAPI + SQLAlchemy (SQLite, WAL), JWT-аутентификация — по адресу `/api`
- **Фронтенд**: React + Vite + Tailwind — собирается в `dist/` и отдаётся как статические файлы
- **MCP**: FastMCP через SSE — по адресам `/sse` и `/messages`
- **Изоляция данных**: полная — доски, задачи, теги, списки и палитра привязаны к пользователю; задачи/теги/списки — дополнительно к своей доске

## Возможности

Канбан-доски с задачами, приоритетами, тегами, датами, циклическими задачами и мультивалютным бюджетом (валюты на пользователя, курсы к USD, пересчёт в выбранную валюту); управление — мышью и свайпом, интерфейс адаптивный (мобильные и PWA). Данные каждого пользователя изолированы, а уведомления о событиях задач можно получать во внешних системах через веб-хуки.

## Безопасность

- `SECRET_KEY` — **обязательная** переменная окружения (приложение не стартует без неё): `python3 -c "import secrets; print(secrets.token_urlsafe(48))"`.
- `CORS_ORIGINS` — список разрешённых origin через запятую; по умолчанию CORS отключён (приложение same-origin).
- `ACCESS_TOKEN_EXPIRE_MINUTES` — срок жизни JWT (по умолчанию 480 минут = 8 ч).
- Bulk-операции не раскрывают внутренние ошибки; `user_id`/`id` защищены от подмены через payload.

## REST API (кратко)

| Домен | Эндпоинты |
|---|---|
| Аутентификация | `GET /api/auth/registration-status`, `POST /api/auth/register`, `POST /api/auth/login`, `GET /api/auth/me` |
| Доски | CRUD `/api/boards` (лимит 20 на пользователя; удаление последней доски запрещено) |
| Задачи | CRUD `/api/tasks?board_id=…`, `POST /api/tasks/bulk`, `POST /api/tasks/{id}/move` (перенос на свою другую доску), `POST /api/tasks/{id}/cycle/skip`, `POST /api/tasks/{id}/cycle/stop`, `GET /api/tasks/{id}/cycle/history`, `GET /api/tasks/{id}/changes` (история правок дат/приоритета/описания/суммы/статуса) |
| Списки и теги | CRUD `/api/lists?board_id=…` + `/api/lists/{board_id}/{id}`, CRUD `/api/tags?board_id=…` + `/api/tags/{board_id}/{id}` |
| Статистика | `GET /api/summary?board_id=…` |
| Веб-хуки (пользователь) | `GET/PUT/DELETE /api/boards/{board_id}/webhook` (один вебхук на доску), `POST /api/boards/{board_id}/webhook/test` (синхронный тест доставки) |
| Валюты | `GET/POST /api/currencies`, `PUT/DELETE /api/currencies/{id}` (параметры валют: код, название, символ, курс к USD) |
| Бюджет | `GET /api/boards/{id}/budget` (итоговые суммы и записи в валюте расчёта доски) |
| Администрирование | `GET/PUT /api/admin/settings/...`, CRUD `/api/admin/users` (вкл. переключатель webhooks_enabled), `POST/DELETE /api/admin/users/{id}/mcp-token`, `GET /api/admin/webhooks` (обзор всех вебхуков, только чтение) |
| Диагностика | `GET /api/health` (статус + версия сборки) |

Даты передаются в формате ISO 8601. Все запросы ограничены текущим пользователем (JWT в заголовке `Authorization: Bearer ***`): чужие доски/задачи/теги/списки возвращают 404.

## MCP-инструменты

Все инструменты принимают `auth_token` первым аргументом (MCP-токен генерируется в панели администратора). Инструменты используют тот же сервисный слой, что и REST API, поэтому поведение идентично. Все инструменты работы с задачами требуют `board_id` (получается через `list_boards`):

- `list_boards` — доски текущего пользователя
- `list_tasks(board_id, …)`, `create_task(board_id, …)`, `update_task(board_id, …)`, `delete_task(board_id, …)` — управление задачами (включая циклические поля и сумму `amount`: доход — положительное число, расход — отрицательное; `list_tasks` отдаёт `amount` по каждой задаче); даты (`start_date`/`deadline`) принимаются строками «ГГГГ-ММ-ДД» или ISO 8601
- `get_board_budget(board_id)` — бюджет доски (по свойствам списков): ПЛАН (списки todo/progress), ФАКТ (done), ИТОГО и записи «название [список]: ±сумма», теперь в валюте расчёта
- `search_tasks(board_id, query_str)` — поиск по названию/описанию в рамках доски
- `list_currencies()` — валюты пользователя (код, название, символ, курс)
- `update_currency_rate(code, rate)` — установить курс валюты (стоимость 1 единицы в USD), например 0.011 для RUB: 10 000 RUB ≈ 110 USD
- `manage_cycle(board_id, task_id, action)` — управление циклом: `complete` / `skip` / `stop` / `history`
- `get_project_summary(board_id)` — сводная статистика доски
- `get_my_profile` — ID и роль текущего пользователя
- `list_all_lists(board_id)` — списки указанной доски


## Тесты

```bash
cd backend && SECRET_KEY=dev python3 -m pytest tests/ -q
```

24 теста: изоляция данных (два пользователя × все роутеры и MCP-инструменты — чужие данные недоступны), мультивалютность (CRUD валют, изоляция курсов, конвертация бюджета), бюджетирование (сумма задачи, полная редактируемость списков — системных имён нет) и модуль веб-хуков (board-scoped API, валидация событий, исключённые события, HMAC-подпись исходящих запросов, очистка вебхуков при запрете пользователю, дедупликация уведомлений планировщика).

## Демо-аккаунт

На проде создан пользователь `demo` / `demo1234` с набором задач, демонстрирующим функционал (списки, приоритеты, теги, циклические, блокирующие, просрочка, архив).

## Локальная разработка

```bash
SECRET_KEY=<generated> ./scripts/dev.sh
```

Бэкенд на `:8000`, dev-сервер фронтенда на `:5173` (с прокси к API).

## Деплой

- Образ собирается в `ghcr.io/jandoer0/mcp-todo:latest`.
- Развёртывание: хост `podman-svc`, управление через **Podman Quadlet** (systemd-юнит), прокси — Caddy. В quadlet заданы `DATABASE_URL` и `SECRET_KEY`.
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
