# PartyCo

**Несколько человек и их AI-агенты работают над одним проектом и не могут сломать код друг другу.**
Самохостимая desktop-программа: ваш код, ваши ключи, ваш сервер. Windows-first, macOS портируемо.

*A self-hosted desktop workspace where several people and their heterogeneous AI coding agents share
one project without breaking each other's code. Your code, your keys, your server.*
[English](#english) ↓

> **Состояние: ранняя разработка.** Работает то, что перечислено ниже, — и только оно. Там, где
> подсистемы ещё нет, программа показывает честное пустое состояние, а не демо-данные. Это
> сознательное правило, а не недоделка: человек, поверивший «Ствол здоров», когда ствол никто не
> проверял, обманут собственным инструментом.

## Зачем это

Когда два человека натравливают на один репозиторий двух агентов, ломается не модель — ломается
общий код. Агент правит файл, которого касается сосед, оба коммитят, trunk краснеет, и никто не
знает, чей ход это сделал.

PartyCo даёт **узкую и честную гарантию: ничего конфликтующего не попадает в trunk**, а обо всём
остальном участник узнаёт рано. Не «мы решим все конфликты» — а «мы не дадим им доехать до общей
ветки». Дальше: изоляция worktree, границы на модулях, серийная очередь на влитие.

## Что уже работает

Запускается и работает на настоящих данных, без моков:

- **Открывается сразу.** Ни сервера поднимать, ни аккаунт заводить не нужно: программа поднимает
  свой координационный хаб на loopback и заводит локального участника молча. Команда — отдельный
  шаг, когда он понадобится.
- **Разговор с агентом** в выбранной папке, история на диске, прерывание хода.
- **Провайдеры**: API-ключ (шифруется системой) или **делегированный CLI** — запускается тот
  `claude` / `codex`, который вы поставили и в который вошли сами. Выбор модели и режима
  полномочий — чипами над полем ввода.
- **Файлы проекта**: дерево, чтение, отказ вместо искажения на бинарниках и больших файлах.
- **Команда**: аккаунты, приглашения, проекты на хабе — если поднять хаб для команды.

Чего ещё нет: ядра `partycod` как демона, границ и зон, merge gate, общего репозитория на хабе.
Экраны Workspace / Leases / Merge queue существуют как дев-стенд и в собранную программу не входят.

## Установка

Нужен **Node.js 24+**.

```bash
npm install
```

Electron качается postinstall-скриптом, который npm 11 блокирует по умолчанию. Один раз:

```bash
npm approve-scripts electron
```

Собрать и запустить:

```bash
npm run build
```

```bash
npm start
```

Установщик под Windows (`apps/desktop/dist/PartyCo-<версия>-setup.exe`, NSIS, per-user, без UAC):

```bash
npm run dist
```

**Сборка не подписана** — сертификата Authenticode у проекта нет, поэтому Windows покажет
SmartScreen-предупреждение при первом запуске.

Шрифты — третья сторона под SIL OFL 1.1, в репозитории их нет; `npm run dev` и `npm run build`
тянут их сами один раз (`npm run fonts`).

## Работать командой

Соло-режим ничего не требует. Для команды нужен хаб на машине, которую видят все участники —
это чистый Node без единой зависимости:

```bash
npm start -w @partyco/hub
```

Слушает `127.0.0.1:7717`, базу кладёт рядом. Первый зарегистрировавшийся становится владельцем.
Развёртывание на VPS, systemd-unit, TLS и бэкапы — [apps/hub/README.md](apps/hub/README.md).

В программе: «Меня позвали в проект команды» на первом запуске или «Работать командой» в
настройках → адрес хаба, который дал пригласивший.

## Ключевые ограничения

Их стоит прочитать до того, как предлагать правки: каждое стоило исследования или пойманного бага.

- **Свой OAuth к подписочным эндпоинтам вендоров запрещён** самими вендорами, на всех тарифах.
  Инструменты, которые так делали, отключили server-side в январе 2026. Выживший паттерн —
  запускать CLI, который участник поставил и в который вошёл сам. Цитаты с URL:
  [docs/providers-and-subscription-legality.md](docs/providers-and-subscription-legality.md).
- **Пять инвариантов держат этот путь легальным**: не читаем credential, не делаем запросов к
  вендору, не показываем экран входа вендора, не подделываем идентичность клиента, процесс — на
  машине участника. Инварианты 1 и 4 покрыты grep-тестом по собственным исходникам.
- **Окружение дочернего процесса собирается по allowlist, а не наследуется.** Одна унаследованная
  `ANTHROPIC_API_KEY` молча переводит участника с подписки на поштучный биллинг, и счёт уходит
  владельцу ключа. Ничего не падает — отличается только счёт.
- **Ключ шифруется системой или не хранится вовсе** (DPAPI / Keychain). Открытым текстом на диск
  не ложится никогда и через мост в интерфейс не отдаётся.
- **Credential'ы не покидают машину участника.** Хаб — coordination plane, не inference plane; в
  его wire-схеме нет поля, способного перенести токен.
- **CRDT для кода отклонён** (ADR-0001). Редактор есть, совместного набора нет.
- **Интерфейс: рабочее место, а не панель приборов.** Разговор — единственная колонка, открытая по
  умолчанию. Любая новая поверхность обязана обосновать своё право быть видимой без спроса.
- **Каждый контрол либо работает, либо не выглядит контролом.** Кнопка, которая ничего не делает,
  хуже отсутствующей кнопки.

## Раскладка

```
docs/                проектные документы — читать первыми
design/raw/          выгрузки Claude Design: источник правды по визуалу, руками не редактируется
packages/tokens/     дизайн-токены: palette.ts → tokens.generated.css (генерируется)
packages/icons/      иконки, извлекаются из выгрузки скриптом
packages/agents/     провайдеры: API-ключ и делегированный CLI. Ноль зависимостей
packages/ui/         библиотека компонентов (CONVENTIONS.md обязателен к прочтению)
apps/desktop/        Electron: main / preload / renderer
apps/hub/            partycod: аккаунты, приглашения, проекты. Ноль зависимостей
```

## Проверка

```bash
npm run check
```

Токены, дизайн-линтер и типизация всего монорепо. Тесты запускаются отдельно и **обязательно с
путями до файлов** — `node --test apps/hub` находит ноль тестов и всё равно завершается успехом:

```bash
node --test apps/hub/test.mjs packages/agents/test.mjs apps/desktop/test-transcript.mjs
```

## Документы

| Файл | Зачем |
|---|---|
| [docs/HANDOFF.md](docs/HANDOFF.md) | Где что лежит, что сделано, чем проверяется, какие вопросы открыты |
| [docs/architecture.md](docs/architecture.md) | Топология, слои, схема БД, протокол, милстоуны |
| [docs/providers-and-subscription-legality.md](docs/providers-and-subscription-legality.md) | Легальность провайдеров. Читать до любого кода про auth |
| [docs/connectivity-options.md](docs/connectivity-options.md) | Транспорт до хаба, варианты A–E |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Как присылать правки |
| [SECURITY.md](SECURITY.md) | Куда писать про уязвимость |

## Лицензия

[MIT](LICENSE).

Шрифты IBM Plex Sans и JetBrains Mono — третья сторона под
[SIL OFL 1.1](https://openfontlicense.org/), в репозитории не хранятся.

---

<a name="english"></a>

## English

**PartyCo is a self-hosted desktop workspace where several people and their heterogeneous AI coding
agents share one project without breaking each other's code.** Your code, your keys, your server.
Windows-first; macOS is portable.

> **Status: early development.** What is listed below works, and nothing else does. Where a
> subsystem does not exist yet, the app shows an honest empty state rather than demo data — a
> deliberate rule, not an omission.

When two people point two agents at one repository, it is not the model that breaks — it is the
shared code. PartyCo makes one narrow, honest guarantee: **nothing conflicting reaches trunk**, and
you learn about everything else early. Worktree isolation, leases on module boundaries, a serialised
merge train.

**It opens straight away** — no server to stand up, no account to create. The app starts its own
coordination hub on loopback and creates a local member silently; joining a team is a separate step
for when you need one.

Working today: a conversation with an agent inside a folder you choose, with history on disk; model
providers via an API key (encrypted by the OS) or a **delegated CLI** — running the `claude` /
`codex` you installed and signed into yourself; the project's file tree; accounts, invitations and
projects on a hub if you run one for a team.

Not there yet: the `partycod` daemon, boundaries and leases, the merge gate, a shared repository on
the hub.

### Getting started

Node.js 24+ required.

```bash
npm install
```

```bash
npm run build
```

```bash
npm start
```

### The constraint that shapes the provider layer

Vendors forbid third-party applications from running their own OAuth against consumer-subscription
endpoints — on every tier. Tools that did it were cut off server-side in January 2026. The pattern
that survived is spawning a CLI the member installed and signed into themselves, and PartyCo holds
five invariants to stay on that side of the line: it never reads a credential, never makes the model
request, never shows a vendor login screen, never spoofs client identity, and always runs the agent
on the member's own machine. Sources with URLs are in
[docs/providers-and-subscription-legality.md](docs/providers-and-subscription-legality.md).

Most documentation is in Russian. The code and its comments are in English.

Contributions welcome — see [CONTRIBUTING.md](CONTRIBUTING.md). Licensed [MIT](LICENSE).
