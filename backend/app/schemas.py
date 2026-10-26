import builtins
import re
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field, computed_field, field_validator

from .security import validate_webhook_url

# Shared limits: the SQLite columns are unbounded VARCHARs, so schemas are
# the only guard against absurd values (DB bloat / UI breakage / DoS).
MAX_TITLE = 200
MAX_DESCRIPTION = 50_000
MAX_LIST_NAME = 100
MAX_TAG_NAME = 50
_MAX_COLOR = re.compile(r"^#[0-9a-fA-F]{6}$")


def _check_color(v: str | None) -> str | None:
    if v is None:
        return v
    if not _MAX_COLOR.match(v or ""):
        raise ValueError("Цвет должен быть в формате #rrggbb")
    return v


def _check_kind(v: str | None) -> str | None:
    if v is not None and v not in ("todo", "progress", "done"):
        raise ValueError("kind должен быть todo, progress или done")
    return v


def _check_list_update_kind(v: str | None) -> str | None:
    if v is not None and v not in ("todo", "progress", "done", "regular"):
        raise ValueError("kind должен быть todo, progress, done или regular")
    return v


class CurrencyResponse(BaseModel):
    id: int
    code: str
    name: str
    symbol: str
    rate: float | None = None  # value of 1 unit in base units (USD); None = не указан
    position: int = 0  # порядок отображения; первая валюта = по умолчанию

    model_config = {"from_attributes": True}

class CurrencyCreate(BaseModel):
    code: str = Field(min_length=1, max_length=10)
    name: str = Field(min_length=1, max_length=100)
    symbol: str = Field(default="", max_length=10)
    rate: float | None = Field(default=None, gt=0, allow_inf_nan=False, le=1e9)

class CurrencyUpdate(BaseModel):
    code: str | None = Field(default=None, min_length=1, max_length=10)
    name: str | None = Field(default=None, min_length=1, max_length=100)
    symbol: str | None = Field(default=None, max_length=10)
    rate: float | None = Field(default=None, gt=0, allow_inf_nan=False, le=1e9)

class CurrencyReorder(BaseModel):
    """Полный порядок валют пользователя (id по порядку отображения)."""

    ids: list[int] = Field(max_length=100)

class BoardResponse(BaseModel):
    id: int
    name: str
    description: str | None = None
    color: str
    position: int
    report_currency_id: int | None = None  # валюта расчёта бюджета

    model_config = {"from_attributes": True}

class BoardCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    description: str | None = Field(default=None, max_length=2000)
    color: str = "#0ea5e9"

    _color_check = field_validator("color")(_check_color)

class BoardUpdate(BaseModel):
    name: str | None = Field(default=None, max_length=100)
    description: str | None = Field(default=None, max_length=2000)
    color: str | None = None
    position: int | None = Field(default=None, ge=0, le=1_000_000)
    # Валюта расчёта бюджета: id валюты пользователя или None (базовая USD)
    report_currency_id: int | None = None

    _color_check = field_validator("color")(_check_color)

# Ключи региональных настроек профиля. Значения живут в словарях перевода
# фронтенда; в БД хранятся именно ключи, чтобы добавление нового языка
# или формата не требовало миграции данных.
DateFormat = Literal["eu", "us", "iso", "friendly"]
FirstDayOfWeek = Literal["monday", "sunday"]


class UserResponse(BaseModel):
    id: int
    username: str
    role: str
    webhooks_enabled: bool = True
    # Локализация и региональные настройки (см. ProfileUpdate ниже).
    language: Literal["ru", "en"] = "ru"
    date_format: DateFormat = "eu"
    first_day_of_week: FirstDayOfWeek = "monday"
    # Stored hashed token is never serialized; only expose whether one is set.
    mcp_token_hash: str | None = Field(default=None, exclude=True)

    model_config = {"from_attributes": True, "extra": "ignore"}

    @computed_field
    @property
    def has_mcp_token(self) -> bool:
        return bool(self.mcp_token_hash)


class ProfileUpdate(BaseModel):
    """Локализация и региональные настройки пользователя (ТЗ «Многоязычность»).
    Все поля опциональны: обновляется только присланное."""

    language: Literal["ru", "en"] | None = None
    date_format: DateFormat | None = None
    first_day_of_week: FirstDayOfWeek | None = None

class UserCreate(BaseModel):
    # min password length is enforced in /auth/register (admin updates may
    # send an empty password meaning "keep the current one").
    username: str = Field(min_length=3, max_length=50)
    password: str = Field(default="", max_length=256)
    role: str | None = "user"
    webhooks_enabled: bool | None = None

class Token(BaseModel):
    access_token: str
    token_type: str

class TaskBase(BaseModel):
    title: str = Field(min_length=1, max_length=MAX_TITLE)
    # Description cap is a server setting (admin panel); the validator below
    # falls back to MAX_DESCRIPTION when the setting is not loaded.
    description: str | None = None
    list: str | None = Field(default="Входящие", max_length=MAX_LIST_NAME)
    start_date: datetime | None = None
    deadline: datetime | None = None
    priority: int | None = Field(default=1, ge=1, le=3)
    tags: builtins.list[str] | None = []
    # Owning board (required for creation; verified server-side)
    board_id: int | None = None
    # Blocking tasks (ids of tasks that must be done before this one)
    blocked_by: builtins.list[int] | None = None
    # Cyclic task settings
    is_cyclic: bool | None = False
    cycle_period: str | None = None  # daily | weekly | monthly | yearly
    cycle_interval: int | None = Field(default=1, ge=1, le=365)
    reminder_days: int | None = Field(default=0, ge=0, le=365)
    # Financial weight: positive = income, negative = expense (0 = no budget)
    amount: float | None = Field(default=0.0, allow_inf_nan=False, ge=-1e12, le=1e12)
    # Currency of the amount (мультивалютность); None = базовая валюта (USD)
    currency_id: int | None = None

    @field_validator("description")
    @classmethod
    def _description_length(cls, v: str | None) -> str | None:
        if v is None:
            return v
        from .site_settings import get_int_ns

        limit = get_int_ns("max_description_length", MAX_DESCRIPTION)
        if len(v) > limit:
            raise ValueError(f"Описание длиннее {limit} символов")
        return v

    @field_validator("cycle_period")
    @classmethod
    def _cycle_period_check(cls, v: str | None) -> str | None:
        if v is not None and v not in ("daily", "weekly", "monthly", "yearly"):
            raise ValueError("cycle_period: daily | weekly | monthly | yearly")
        return v

class TaskCreate(TaskBase):
    pass

class TaskUpdate(BaseModel):
    title: str | None = None
    description: str | None = None
    list: str | None = None
    start_date: datetime | None = None
    deadline: datetime | None = None
    priority: int | None = None
    tags: builtins.list[str] | None = None
    blocked_by: builtins.list[int] | None = None
    # Cyclic task settings
    is_cyclic: bool | None = None
    cycle_period: str | None = None
    cycle_interval: int | None = None
    reminder_days: int | None = None
    amount: float | None = None
    currency_id: int | None = None
    position: float | None = None  # DnD: client-computed insert order
    # Completion of a cyclic iteration: real date and real amount go to history.
    actual_date: datetime | None = None
    actual_amount: float | None = Field(default=None, ge=-1e12, le=1e12)

class CycleComplete(BaseModel):
    """Финансовое подтверждение завершения циклической итерации."""
    actual_date: datetime | None = None  # по умолчанию — текущий момент
    actual_amount: float | None = Field(default=None, ge=-1e12, le=1e12)  # по умолчанию — план

class CycleLogUpdate(BaseModel):
    """Корректировка записи истории цикла (только выполненные итерации)."""
    actual_date: datetime | None = None
    actual_amount: float | None = Field(default=None, ge=-1e12, le=1e12)

class TagResponse(BaseModel):
    id: int
    name: str
    color: str

    model_config = {"from_attributes": True}

class TaskListResponse(BaseModel):
    id: int
    name: str
    color: str
    position: int
    # Semantics of protected default lists: 'todo' | 'progress' | 'done'
    kind: str | None = None

    model_config = {"from_attributes": True}

class TaskListCreate(BaseModel):
    name: str = Field(min_length=1, max_length=MAX_LIST_NAME)
    color: str | None = None
    position: int | None = Field(default=None, ge=0, le=1_000_000)
    # 'todo' | 'progress' | 'done' | None (regular list)
    kind: str | None = None

    _color_check = field_validator("color")(_check_color)
    _kind_check = field_validator("kind")(_check_kind)

class TaskListUpdate(BaseModel):
    name: str | None = Field(default=None, max_length=MAX_LIST_NAME)
    color: str | None = None
    position: int | None = Field(default=None, ge=0, le=1_000_000)
    # Системный список «Регулярные» принимает только постоянный kind='regular'
    # (сервер дополнительно проверяет его по владельцу/доске).
    kind: str | None = None

    _color_check = field_validator("color")(_check_color)
    _kind_check = field_validator("kind")(_check_list_update_kind)

class TagCreate(BaseModel):
    name: str = Field(min_length=1, max_length=MAX_TAG_NAME)
    color: str

    _color_check = field_validator("color")(_check_color)

class TagUpdate(BaseModel):
    name: str | None = Field(default=None, max_length=MAX_TAG_NAME)
    color: str | None = None

    _color_check = field_validator("color")(_check_color)

class TaskResponse(BaseModel):
    id: int
    title: str
    description: str | None = None
    list: str
    board_id: int | None = None
    start_date: datetime | None = None
    deadline: datetime | None = None
    priority: int
    tags: list[str] = []
    created_at: datetime
    blocked_by: list[int] = []
    is_blocked: bool = False
    # Cyclic task info
    is_cyclic: bool = False
    cycle_period: str | None = None
    cycle_interval: int | None = 1
    cycle_group_id: str | None = None
    reminder_days: int | None = 0
    cycle_dormant: bool = False  # cyclic task outside its reminder window
    amount: float = 0.0  # financial weight (income + / expense -)
    currency_id: int | None = None  # валюта суммы (NULL = базовая)
    position: float = 0.0  # горизонтальный порядок карточки в колонке (ТЗv2 §1.4)

    model_config = {"from_attributes": True}

    @field_validator("amount", mode="before")
    @classmethod
    def _amount_default(cls, v):
        # Legacy rows may carry NULL (column added by migration) — treat as 0.
        return 0.0 if v is None else v

    @field_validator("tags", mode="before")
    @classmethod
    def validate_tags(cls, v):
        if isinstance(v, list):
            return [tag.name if hasattr(tag, "name") else str(tag) for tag in v]
        return v

class SummaryResponse(BaseModel):
    total: int
    todo: int
    in_progress: int
    done: int
    overdue: int
    planned: int = 0

class SettingsResponse(BaseModel):
    allow_registration: bool
    db_size_limit_mb: int = 0
    # --- Security ---
    session_expire_minutes: int = 480
    login_rate_limit: bool = True
    login_max_attempts: int = 10
    login_window_sec: int = 300
    register_rate_limit_per_hour: int = 30
    password_min_length: int = 6
    max_body_mb: int = 2
    maintenance_mode: bool = False
    # --- Notifications / scheduler ---
    scheduler_interval_min: int = 30
    deadline_window_hours: int = 24
    overdue_repeat_hours: int = 24
    webhook_timeout_sec: int = 10
    # --- Limits ---
    max_boards_per_user: int = 20
    max_description_length: int = 50_000


class AdminSettingsUpdate(BaseModel):
    """Partial update of the tunables (PUT /admin/settings); only the
    provided fields are written. Bounds keep admin input sane."""

    session_expire_minutes: int | None = Field(default=None, ge=60, le=43_200)
    login_rate_limit: bool | None = None
    login_max_attempts: int | None = Field(default=None, ge=1, le=1000)
    login_window_sec: int | None = Field(default=None, ge=30, le=86_400)
    register_rate_limit_per_hour: int | None = Field(default=None, ge=0, le=10_000)
    password_min_length: int | None = Field(default=None, ge=4, le=128)
    max_body_mb: int | None = Field(default=None, ge=1, le=100)
    maintenance_mode: bool | None = None
    scheduler_interval_min: int | None = Field(default=None, ge=1, le=1440)
    deadline_window_hours: int | None = Field(default=None, ge=1, le=720)
    overdue_repeat_hours: int | None = Field(default=None, ge=0, le=720)
    webhook_timeout_sec: int | None = Field(default=None, ge=1, le=120)
    max_boards_per_user: int | None = Field(default=None, ge=1, le=1000)
    max_description_length: int | None = Field(default=None, ge=1000, le=1_000_000)


class ServerStatsResponse(BaseModel):
    db: int
    wal: int
    total: int
    db_size_limit_mb: int
    uptime_seconds: int
    counts: dict[str, int]

class TaskChangeLogResponse(BaseModel):
    id: int
    field: str
    old_value: str | None = None
    new_value: str | None = None
    changed_at: datetime

    model_config = {"from_attributes": True}


class CycleLogResponse(BaseModel):
    id: int
    task_title: str
    action: str
    deadline: datetime | None = None
    planned_amount: float | None = None
    actual_amount: float | None = None
    actual_date: datetime | None = None
    currency_id: int | None = None
    logged_at: datetime

    model_config = {"from_attributes": True}

class TaskBulkUpdate(BaseModel):
    # Bounded: a single bulk request may not carry an unbounded task list.
    tasks: list[dict[str, Any]] = Field(max_length=500)

class TaskMove(BaseModel):
    board_id: int

class TaskReorder(BaseModel):
    """Один запрос на перенос карточки при DnD (ТЗv2 §1.4)."""
    list: str = Field(min_length=1, max_length=MAX_LIST_NAME)
    position: float = Field(ge=0, le=1_000_000_000)

class BulkUpdateResponse(BaseModel):
    updated: int
    created: int
    errors: list[dict[str, Any]] = []


# --- Перенос доски: экспорт/импорт всех задач, включая циклические -------------

EXPORT_FORMAT = "mcp-todo-board"


class TransferList(BaseModel):
    """Список доски в переносимом файле (сопоставление при импорте — по имени)."""

    name: str = Field(min_length=1, max_length=MAX_LIST_NAME)
    color: str | None = None
    position: int = Field(default=1, ge=0, le=1_000_000)
    kind: str | None = None
    is_default: bool = False

    _color_check = field_validator("color")(_check_color)

    @field_validator("kind")
    @classmethod
    def _kind_check(cls, v):
        if v not in (None, "todo", "progress", "done", "regular"):
            raise ValueError("kind должен быть todo, progress, done или regular")
        return v


class TransferTag(BaseModel):
    name: str = Field(min_length=1, max_length=MAX_TAG_NAME)
    color: str | None = None

    _color_check = field_validator("color")(_check_color)


class TransferTask(BaseModel):
    """Задача в переносимом файле. Идентификаторы БД не переносятся:
    список — по имени, теги — по именам, валюта — по коду.
    Блокеры задаются индексами в массиве tasks (dependencies)."""

    title: str = Field(min_length=1, max_length=MAX_TITLE)
    description: str | None = None
    list: str | None = None
    start_date: datetime | None = None
    deadline: datetime | None = None
    priority: int = Field(default=1, ge=1, le=3)
    amount: float = Field(default=0.0, ge=-1e12, le=1e12, allow_inf_nan=False)
    currency_code: str | None = None
    tags: builtins.list[str] = []
    is_cyclic: bool = False
    cycle_period: str | None = None
    cycle_interval: int = Field(default=1, ge=1, le=365)
    cycle_group_id: str | None = None
    reminder_days: int = Field(default=0, ge=0, le=365)
    created_at: datetime | None = None

    @field_validator("cycle_period")
    @classmethod
    def _cycle_period_check(cls, v):
        if v is not None and v not in ("daily", "weekly", "monthly", "yearly"):
            raise ValueError("cycle_period: daily | weekly | monthly | yearly")
        return v


class TransferDependency(BaseModel):
    """Блокер: задачи[blocker] блокирует задачи[blocked] (индексы в tasks)."""

    blocker: int = Field(ge=0)
    blocked: int = Field(ge=0)


class TransferCycleLog(BaseModel):
    """Запись истории итераций (факты «План vs Факт» переносятся вместе
    с циклическими задачами, чтобы график сохранил ретроспективу)."""

    cycle_group_id: str
    task_title: str
    action: str  # completed | stopped
    deadline: datetime | None = None
    planned_amount: float | None = Field(default=None, ge=-1e12, le=1e12)
    actual_amount: float | None = Field(default=None, ge=-1e12, le=1e12)
    actual_date: datetime | None = None
    currency_code: str | None = None
    logged_at: datetime | None = None

    @field_validator("action")
    @classmethod
    def _action_check(cls, v):
        if v not in ("completed", "stopped"):
            raise ValueError("action: completed | stopped")
        return v


class TransferBoardData(BaseModel):
    """Тело переносимого файла (экспорт одной доски)."""

    format: str | None = None
    version: int = 1
    board: dict[str, Any] = {}
    lists: builtins.list[TransferList] = []
    tags: builtins.list[TransferTag] = []
    tasks: builtins.list[TransferTask] = Field(default=[], max_length=2000)
    dependencies: builtins.list[TransferDependency] = Field(default=[], max_length=5000)
    cycle_history: builtins.list[TransferCycleLog] = Field(default=[], max_length=5000)


class BoardImportRequest(BaseModel):
    data: TransferBoardData
    mode: str = "merge"  # merge — добавить к существующим | replace — заменить

    @field_validator("mode")
    @classmethod
    def _mode_check(cls, v):
        if v not in ("merge", "replace"):
            raise ValueError("mode: merge | replace")
        return v

class WebhookPut(BaseModel):
    """Payload for the board-scoped upsert (PUT /boards/{id}/webhook):
    user and board are taken from the caller and the path, one webhook
    per board. All fields are optional: on update only the provided ones
    are replaced; on creation url and chat_id are required."""

    name: str | None = Field(default=None, max_length=100)
    url: str | None = Field(default=None, max_length=2048)
    token: str | None = Field(default=None, max_length=256)  # HMAC secret
    chat_id: str | None = Field(default=None, max_length=100)
    thread_id: str | None = Field(default=None, max_length=50)
    events: builtins.list[str] | None = None
    excluded_events: builtins.list[str] | None = None

    @field_validator("url")
    @classmethod
    def _url_check(cls, v: str | None) -> str | None:
        if v is None:
            return None
        v = v.strip()
        if not v:
            raise ValueError("Укажите URL приёмника уведомлений")
        if " " in v:
            raise ValueError("URL не должен содержать пробелов")
        # SSRF guard: http(s) only, public hosts only (see security.py).
        return validate_webhook_url(v)

    @field_validator("chat_id")
    @classmethod
    def _chat_id_check(cls, v: str | None) -> str | None:
        if v is None:
            return None
        v = (v or "").strip()
        if not v:
            raise ValueError("Укажите Telegram Chat ID (например: -1001234567890)")
        return v

    @field_validator("thread_id")
    @classmethod
    def _thread_id_check(cls, v: str | None) -> str | None:
        return v.strip() if v and v.strip() else None


class WebhookResponse(BaseModel):
    id: int
    user_id: int
    board_id: int | None = None
    name: str
    url: str
    token: str | None = None
    chat_id: str
    thread_id: str | None = None
    events: builtins.list[str] = []
    excluded_events: builtins.list[str] = []
    created_at: datetime
    board_name: str | None = None  # filled for the admin overview table

    model_config = {"from_attributes": True}
