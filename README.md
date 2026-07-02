# Browser Agent

Автономный CLI-агент, который по задаче на естественном языке управляет видимым Chrome и решает многошаговые задачи: сам строит план в моменте, находит селекторы в рантайме и останавливается перед необратимыми действиями. Реализован по `tz_browser_agent.md`.

## Запуск

Требования: Node.js LTS, установленный Google Chrome, ключ OpenAI.

```bash
npm install
cp .env.example .env    # вписать OPENAI_API_KEY
npm run dev
```

Одна команда поднимает headed Chrome с persistent-профилем и терминальный REPL. Задача вводится строкой:

```
browser-agent> Открой Яндекс Лавку, найди хот-дог и добавь его в корзину. Оплату не производи.
```

Полезные флаги и переменные:

```bash
npm run dev -- --profile-dir .browser-profile   # путь к профилю Chrome
npm run dev -- --reset-profile                  # сброс профиля
npm run dev -- --help                           # все переменные окружения
```

Для сервисов с логином: один раз войти вручную в открывшемся окне Chrome — куки сохраняются в persistent-профиле между запусками.

## Архитектура

```
Пользователь (терминал REPL)
        │  задача на NL
        ▼
Orchestrator (src/agent/orchestrator.ts)
  observe → LLM выбирает один тул → security-гейт → execute → результат в историю → повтор
        │                                   │
        │ generic-тулы                      │ query_dom(NL-вопрос)
        ▼                                   ▼
Browser layer (Playwright,          DOM Sub-agent (src/subagents/dom-agent.ts)
persistent Chrome)                  aria snapshot + кандидаты → текст + селектор
```

**Оркестратор** — ReAct-цикл: компактное наблюдение (URL, title, результат прошлого тула) → LLM с tool schemas → один tool call → результат в контекст. Стоп-условия: `done`, security-гейт, лимиты (`maxSteps`, `maxConsecutiveErrors`, детект зацикливания).

**Тулы** — только атомарные примитивы: `navigate`, `query_dom`, `click`, `type`, `scroll`, `wait`, `read_page`, `screenshot`, `ask_user`, `done`. Никаких задач-специфичных заготовок.

**DOM sub-agent** — единственное место, где живёт сырое представление страницы; в контекст оркестратора оно не попадает. Перцепция (`src/browser/perception.ts`): `page.ariaSnapshot()` как компактная основа + дайджест интерактивных элементов (видимые `a/button/input/...` с приоритетом селекторов `id` → `data-testid` → `name` → `aria-label` → `text`). Sub-agent (дешёвая модель) получает вопрос оркестратора и это представление, возвращает ответ + селектор + confidence.

**Управление контекстом** (`src/agent/context.ts`): последние N шагов детально + rolling summary более ранних; жёсткая обрезка любого текста до X символов; системный промпт и tool schemas — стабильный префикс для prompt caching. Полный лог виден в терминале, в модель летят только выжимки.

**Обработка ошибок** (`src/agent/orchestrator.ts`, `src/agent/progress.ts`): ошибка тула кладётся в контекст как результат — оркестратор переосмысляет (повторный `query_dom`, `scroll`, `wait`); устаревшие селекторы дают recoverable-ошибку; детект зацикливания по повторяющимся действиям без смены состояния; таймауты на LLM-шаг и исполнение тулов (ожидание ответа пользователя таймаутом не ограничено).

**Security-гейт** (`src/agent/security.ts`): перед `click`/`type`/`navigate` отдельный дешёвый LLM-классификатор оценивает семантику действия в рантайме (оплата, покупка, удаление, отправка, подтверждение заказа) — без хардкода кнопок. При «необратимо» — пауза и явное подтверждение `y/n` в терминале; отказ пользователя блокирует действие, и агент завершает работу отчётом. Нечитаемый ответ классификатора трактуется как «требует подтверждения» (fail closed).

## Принятые решения

- **Playwright `launchPersistentContext` + `channel: 'chrome'`, headed** — persistent-сессии и меньше антибот-детекта.
- **OpenAI Responses API** через тонкую абстракцию `LLMProvider` (`src/llm/provider.ts`); модели оркестратора и sub-agent задаются независимо в `.env` (по умолчанию `gpt-5.4-mini` / `gpt-5.4-nano`). Поддерживается любой OpenAI-совместимый endpoint через `BROWSER_AGENT_API_BASE_URL` — например OpenRouter (`https://openrouter.ai/api/v1`, ключ OpenRouter в `OPENAI_API_KEY`, модели вида `openai/gpt-5.4-mini`); учтите, что Responses API у OpenRouter в статусе beta.
- **Текстовая перцепция как основной канал**: aria snapshot дешевле и структурнее скриншотов; vision не используется. `screenshot` — для видимого лога.
- **Классификатор безопасности как отдельный LLM-вызов** на дешёвой модели, а не часть рассуждения оркестратора: изолированный промпт нельзя «переубедить» ходом основной сессии.
- **Отказ гейта — feedback, а не жёсткий стоп**: блокировка кладётся в контекст, и модель сама завершает задачу через `done` с корректным отчётом («дошёл до корзины, оплата остановлена»).

## Лимиты и конфиг

Все лимиты — в `.env` (см. `.env.example`): `BROWSER_AGENT_MAX_STEPS=40`, `BROWSER_AGENT_MAX_CONSECUTIVE_ERRORS=5`, `BROWSER_AGENT_MAX_NO_PROGRESS=4`, `BROWSER_AGENT_STEP_TIMEOUT_MS=30000`, `BROWSER_AGENT_CONTEXT_RECENT_STEPS=8`, `BROWSER_AGENT_CONTEXT_MAX_TEXT_CHARS=2000`.

## Тесты

```bash
npm run typecheck
npm test
```

Unit-тесты покрывают config, REPL, контекст, детект зацикливания, tool schemas, security-гейт и цикл задач на mock-провайдере. `tests/browser-smoke.test.ts` гоняет перцепцию, click/type и stale-selector recovery на реальном Chrome с локальной HTML-фикстурой (самопропускается, если Chrome недоступен).

## Демо

Сценарий: «Открой Яндекс Лавку, выбери мой сохранённый адрес, найди хот-дог и добавь в корзину. Оплату не производи.» Подготовка: один ручной логин в Яндекс в persistent-профиле. В терминале виден поток `Using tool / Input / Result`, ответы DOM sub-agent, решения security-гейта; финал — `Agent report` и явная остановка перед оплатой.
