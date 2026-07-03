# Browser Agent

Autonomous browser agent for multi-step web tasks in a real, visible Chrome session.

Browser Agent - CLI-агент для управления видимым Chrome через Playwright. Проект реализован по тестовому заданию из `tz_browser_agent.md`: агент получает задачу на естественном языке, сам исследует сайт, извлекает данные со страниц, выполняет действия через generic tools и останавливается перед необратимыми операциями, если нужно подтверждение пользователя.

Главная идея реализации: модель не управляет селекторами и не исполняет заранее зашитые сценарии. LLM принимает решения, а runtime держит под контролем клики, навигацию, память объектов, checkpoints и security gate.

## Что умеет агент

Агент запускает терминальный REPL и persistent Chrome-профиль. Пользователь вводит задачу одной строкой, после чего агент циклически:

1. наблюдает текущую страницу;
2. просит DOM sub-agent извлечь компактные факты, candidates и объекты;
3. выбирает один tool call;
4. выполняет действие через runtime;
5. обновляет `ObjectMemory` и историю шагов;
6. продолжает до завершения, подтверждения пользователя или честного блокера.

Архитектура рассчитана на три acceptance-сценария из ТЗ:

- прочитать последние письма, классифицировать спам и удалить подтвержденные спам-письма;
- найти еду, добавить нужные позиции в корзину и остановиться перед финальной оплатой;
- изучить резюме, найти релевантные вакансии, подготовить сопроводительные письма и откликнуться после подтверждения.

## Демо

Видео демонстрирует HH stress-test из ТЗ:

> Найди 3 подъодящие вакансии AI-инженера на hh.ru и откликнись на них с сопроводительным, предварительно изучив резюме в моём профиле.

Что должен сделать агент в этом сценарии:

1. перейти на `hh.ru`;
2. изучить профиль/резюме пользователя;
3. найти релевантные вакансии AI-инженера;
4. извлечь ключевую информацию по каждой вакансии;
5. подготовить персонализированные сопроводительные письма;
6. перед каждым откликом запросить подтверждение пользователя.

Предусловие: пользователь уже вошел в аккаунт `hh.ru` в persistent Chrome-профиле.

Видео: [HH stress-test recording](https://disk.yandex.ru/i/GOJYr6vzLmYUSA).

## Ключевые решения

### `candidateId` вместо LLM-селекторов

LLM не получает raw Playwright selectors. Перцепция страницы создает page-scoped candidates: `c1`, `c2`, `c3` и так далее. Внутренние selector recipes остаются в `CandidateRegistry`.

Модель может вызвать:

- `click({ candidateId })`;
- `open_candidate({ candidateId })`;
- `type({ candidateId, text })`.

Она не может передать selector string, ARIA `ref` или выдуманный locator. Это убирает класс ошибок вида `role=button[name="..."][ref=e123]`, которые не являются runtime-селекторами.

### Anti-guessing для URL

Навигация разрешена только в два источника:

- URL/домены, явно указанные в задаче пользователя;
- `href`, реально найденные в DOM и привязанные к candidate.

Внутренние пути вроде `/account/resumes` блокируются, если они не пришли из задачи или со страницы.

### `ObjectMemory`

DOM sub-agent может извлекать структурные объекты:

- `email`;
- `product`;
- `vacancy`;
- `resume`;
- `other`.

Каждый объект получает стабильный `objectId`, поля, ссылки на candidate/action candidate и статус:

`seen -> opened -> details_extracted -> reviewed -> selected -> action_ready -> action_done`

Это позволяет вести задачу через несколько страниц без зависимости от свободного текста модели.

### Checkpoints

Ключевые требования enforce-ятся кодом:

- нельзя выбрать объект, который был только виден в списке, но не был открыт/изучен;
- destructive/binding batch-действия требуют подтверждения;
- `done` блокируется, если выбранный или подтвержденный batch не завершен;
- агент может завершить задачу раньше только с явным `incomplete_reason`.

### Batch-действия

Для multi-object workflows есть generic tools:

- `propose_selection({ objectType, objectIds, reason })`;
- `confirm_batch({ summary })`;
- `execute_batch({ action, objectIds })`.

Поддерживаемые batch actions: `delete`, `mark_spam`, `add_to_cart`, `apply`, `send_message`, `stop_before_payment`.

Для per-item форм, например отклика с персональным сопроводительным письмом, агент работает по одному объекту за раз: открывает вакансию, пишет текст, отправляет после подтверждения security gate.

### Security gate

Потенциально необратимые действия проверяются отдельным LLM-классификатором и требуют явного подтверждения в терминале. Это касается оплаты, покупки, удаления, отправки сообщений и откликов. При неуверенности classifier работает fail closed.

## Архитектура

```text
User task
   |
   v
Terminal REPL
   |
   v
Orchestrator LLM
   |        \
   |         \ query_dom/read_page
   |          v
   |      DOM sub-agent
   |          |
   |          v
   |      aria snapshot + public candidates + extracted objects
   |
   v
Tool runtime
   |
   +-- CandidateRegistry: candidateId -> internal Playwright locator recipe
   +-- ObjectMemory: stable objectId/status across pages
   +-- Checkpoint guards
   +-- SecurityGate
   |
   v
Playwright headed persistent Chrome
```

Основные файлы:

- `src/index.ts` - CLI entry point и wiring REPL.
- `src/agent/orchestrator.ts` - основной agent loop.
- `src/agent/tools.ts` - tool schemas и runtime implementation.
- `src/browser/perception.ts` - compact page perception.
- `src/browser/candidate-registry.ts` - internal candidate registry.
- `src/subagents/dom-agent.ts` - DOM sub-agent protocol и parsing.
- `src/agent/object-memory.ts` - structured object memory.
- `src/agent/checkpoints.ts` - workflow checkpoint guards.
- `src/agent/security.ts` - confirmation classifier.

## Запуск

Требования:

- Node.js LTS;
- установленный Google Chrome;
- OpenAI-compatible API key;
- залогиненный browser profile для сервисов, где нужна авторизация.

Установка:

```bash
npm install
```

Создать локальный `.env`:

```bash
cp .env.example .env
```

Минимально нужно указать:

```env
OPENAI_API_KEY=...
```

Запуск:

```bash
npm run dev
```

После старта откроется видимый Chrome и появится REPL:

```text
browser-agent>
```

Пример задачи:

```text
browser-agent> Найди 3 подходящие вакансии AI-инженера на hh.ru и откликнись на них с сопроводительным, предварительно изучив резюме в моём профиле
```

Полезные флаги:

```bash
npm run dev -- --profile-dir .browser-profile
npm run dev -- --reset-profile
npm run dev -- --help
```

По умолчанию используется persistent Chrome profile. Если сервис требует логин, достаточно один раз войти вручную в открывшемся окне Chrome; cookies/session state сохраняются между запусками.

## Конфигурация

Секреты должны храниться только в `.env`. Реальные ключи, cookies и browser profile data не коммитятся.

Основные переменные:

```env
BROWSER_AGENT_PROFILE_DIR=.browser-profile
BROWSER_AGENT_SCREENSHOT_DIR=.screenshots
BROWSER_AGENT_NAV_TIMEOUT_MS=30000
BROWSER_AGENT_ACTION_TIMEOUT_MS=10000
BROWSER_AGENT_ORCHESTRATOR_MODEL=gpt-5.4-mini
BROWSER_AGENT_DOM_MODEL=gpt-5.4-nano
BROWSER_AGENT_CONTEXT_RECENT_STEPS=8
BROWSER_AGENT_CONTEXT_MAX_TEXT_CHARS=2000
BROWSER_AGENT_MAX_STEPS=40
BROWSER_AGENT_MAX_CONSECUTIVE_ERRORS=5
BROWSER_AGENT_MAX_NO_PROGRESS=4
BROWSER_AGENT_STEP_TIMEOUT_MS=30000
BROWSER_AGENT_API_BASE_URL=
OPENAI_API_KEY=
```

`BROWSER_AGENT_API_BASE_URL` можно использовать для OpenAI-compatible endpoint. В коде LLM-вызовы изолированы за небольшим `LLMProvider`.

## Тесты

```bash
npm run typecheck
npm test
```

Тесты покрывают:

- config parsing и REPL behavior;
- strict tool schemas и argument validation;
- candidate registry и browser smoke flows на локальной HTML-фикстуре;
- URL anti-guessing;
- DOM sub-agent JSON parsing;
- object memory;
- checkpoints;
- batch actions;
- security gate behavior;
- task-loop recovery и no-progress detection.

## Anti-requirements

В проекте намеренно нет:

- hardcoded site selectors;
- scripted task-specific action sequences;
- hardcoded business URLs или внутренних page paths;
- передачи full HTML pages в model context;
- хранения секретов вне `.env`.

## Текущий статус

MVP acceptance scenarios из ТЗ реализованы архитектурно и покрыты тестами generic-механизмов. HH application flow прогнан как основной live stress-test и записан на видео.
