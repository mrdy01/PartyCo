# PartyCo

Самохостимая desktop-«коробка»: несколько живых людей и их разнородные AI-агенты работают над одним
проектом и **не могут сломать код друг другу**. Windows-first, macOS — портируемо.

Гарантия формулируется узко и честно: **ничего конфликтующего не попадает в trunk**, а обо всём
остальном участник узнаёт рано.

## Состояние

Проектные документы + фундамент UI. Ядра (`partycod`) ещё нет — см. милстоуны в
[docs/architecture.md](docs/architecture.md) §12.

| Что | Где | Готовность |
|---|---|---|
| **Передача контекста** | [docs/HANDOFF.md](docs/HANDOFF.md) | ✅ читать первым |
| Архитектура, 13 разделов | [docs/architecture.md](docs/architecture.md) | ✅ |
| Провайдеры + легальность подписок | [docs/providers-and-subscription-legality.md](docs/providers-and-subscription-legality.md) | ✅ |
| Транспорт подключения (варианты A–E) | [docs/connectivity-options.md](docs/connectivity-options.md) | ✅ |
| Дизайн: система + Workspace + Leases + Merge queue | `design/raw/` | ✅ импортировано |
| Обмен с дизайнером, открытые вопросы | [docs/design-handoff.md](docs/design-handoff.md) | ✅ |
| Токены | `packages/tokens` | ✅ 113 токенов, обе темы, обе плотности |
| Иконки | `packages/icons` | ✅ 29 иконок, все из каталога §04 |
| Библиотека компонентов | `packages/ui` | ✅ 57 компонентов, 334 экспорта |
| Страница дизайн-системы | `apps/desktop/.../designsystem` | ✅ живая сверка с выгрузкой |
| **Экран 2.1 Workspace** | `apps/desktop/.../Workspace.tsx` | ✅ 4 состояния, живые счётчики |
| **Экран 2.3 Leases** | `apps/desktop/.../Leases.tsx` | ✅ 5 состояний, карта владения, живой TTL |
| **Экран 2.4 Merge queue** | `apps/desktop/.../MergeQueue.tsx` | ✅ 6 сценариев, 3 вида отказа гейта, живая очередь |
| Electron-оболочка | `apps/desktop` | ✅ main / preload / renderer, собирается |
| Экраны 2.2, 2.5–2.10 | — | ⬜ следующий 2.8 Providers |
| Ядро `partycod` | — | ⬜ M0 |

## Раскладка

```
docs/                     проектные документы (читать первыми)
design/raw/               выгрузка из Claude Design — источник правды по визуалу, не редактируется
packages/tokens/          дизайн-токены: palette.ts → tokens.generated.css
packages/icons/           29 иконок, извлекаются из дизайна скриптом
packages/ui/              библиотека компонентов (CONVENTIONS.md обязателен к прочтению)
apps/desktop/             Electron-оболочка: main / preload / renderer
```

## Запуск

```bash
npm install
```

Приложение начинается с входа, а вход требует хаба. Подними его первым — он на чистом Node, ставить
нечего:

```bash
npm start -w @partyco/hub
```

Слушает `127.0.0.1:7717`, базу кладёт в `hub.db` рядом с собой. Первый зарегистрировавшийся получает
роль `owner`. Развёртывание на VPS, systemd-unit и бэкапы — [apps/hub/README.md](apps/hub/README.md).

Electron-бинарь качается postinstall-скриптом, который npm 11 блокирует по умолчанию. Один раз:

```bash
npm approve-scripts electron
```

Полное приложение (Electron), режим разработки:

```bash
npm run dev
```

Собрать и запустить собранное — то, что и есть «программа»:

```bash
npm run build
```

```bash
npm start
```

Установщик:

```bash
npm run dist
```

Кладёт `apps/desktop/dist/PartyCo-<версия>-setup.exe` — NSIS, per-user (без UAC), с выбором папки,
ярлыками на рабочем столе и в меню «Пуск». Рядом `dist/win-unpacked/PartyCo.exe` — то же приложение
без установки, для быстрой проверки.

**Сборка не подписана.** Сертификата Authenticode у проекта нет, поэтому Windows покажет
SmartScreen-предупреждение при первом запуске. Когда сертификат появится, он добавляется в
`apps/desktop/electron-builder.yml` (или через `CSC_LINK` / `CSC_KEY_PASSWORD`), больше ничего менять
не нужно.

Иконка **генерируется** из логотипа дизайна, руками не правится:

```bash
npm run -w @partyco/desktop icon
```

Только UI в браузере, без Electron и без бинаря — так быстрее всего смотреть дизайн-систему:

```bash
npm run -w @partyco/desktop dev:web
```

## Проверка

```bash
npm run check
```

Прогоняет три вещи: пересборку токенов, `check:design` и типизацию всего монорепо.
`check:design` — не косметика, каждое правило появилось из реально пойманного бага:

- **animation-not-global** — Vite локализует имена анимаций в CSS-модулях, поэтому
  `animation: pc-pulse` компилируется в несуществующее имя и анимация молча не играет.
  Нужно `animation: global(pc-pulse)`.
- **raw-colour** — ни одного хекса в компонентах, только токены.
- **identity-token-in-css** — цвет участника берётся хелперами из `identity.ts`, а не строкой
  `var(--pc-id-…)`, иначе он утекает за пределы разрешённых ролей.
- **unknown-token** — ссылка на несуществующий `--pc-*`.

## Пересборка из дизайна

Токены и иконки **генерируются** из выгрузки дизайна. Руками не править:

```bash
npm run build:tokens
```

```bash
node packages/icons/scripts/extract.mjs
```

При новой выгрузке из Claude Design: положить файлы в `design/raw/`, прогнать оба скрипта,
затем сверить компоненты — расхождения ловятся глазами на странице дизайн-системы в приложении.

## Ключевые ограничения (не пересматривать без причины)

- **Провайдерский слой**: API-ключ — единственный официально поддерживаемый режим для
  Anthropic / OpenAI / Google. Свой OAuth к подписочным эндпоинтам **запрещён** вендорами —
  см. цитаты в [docs/providers-and-subscription-legality.md](docs/providers-and-subscription-legality.md) §1.
- **Credential'ы не покидают машину участника.** Hub — coordination plane, не inference plane.
  В его wire-схеме нет поля, способного перенести токен.
- **Цвет участника — четыре роли**: заливка аватара, кромка зоны 2px, подложка гаттера диффа,
  площадь владения. **Статусный — четыре**: точка, пилюля, текст, обводка. Запрещено: статусный цвет
  как большая заливка и как левая кромка зоны. Подробности — `packages/ui/CONVENTIONS.md` §5.
- **CRDT для кода отклонён** (ADR-0001). Встроенный редактор есть, совместного набора нет.
- **Шрифты бандлятся локально.** В renderer'е строгий CSP без внешних хостов; приложение обязано
  работать офлайн.
