/**
 * The Russian dictionary — and the source of truth for the dictionary's *shape*.
 *
 * Every string here was already in the product; this file moved them together rather than
 * rewriting them, so the wording is the wording that was reviewed. `Dictionary` in `./index.tsx`
 * widens these literals into the contract `en.ts` has to satisfy, which is what makes a missing
 * English entry a type error instead of a Russian sentence in an English window.
 *
 * Two rules for anything added here:
 *
 *  1. **Interpolation is a function, not a placeholder.** `Шаг 1 из 2` is a sentence whose word
 *     order a translator may need to change, and `'Шаг {step} из {total}'` does not let them. A
 *     function does, and it also makes the arguments type-checked.
 *  2. **Keys name the surface, not the sentence.** `settings.folder.title`, never
 *     `settings.folderOnThisMachine` — the second has to be renamed when the wording changes, which
 *     is exactly when nobody wants to touch two files.
 */

export const RU = {
  /** Words that appear in more than one place, and must not drift between them. */
  common: {
    cancel: 'Отмена',
    close: 'Закрыть',
    open: 'Открыть',
    change: 'Сменить',
    add: 'Добавить',
    ready: 'Готово',
  },

  /** The language switch describes itself. */
  language: {
    title: 'Язык',
    label: 'Язык интерфейса',
    note: 'Переключается сразу, помнится между запусками.',
  },

  /** The composer — the one place a person says what to do next. */
  composer: {
    placeholder: 'Что делаем дальше?',
    fieldLabel: 'Что делаем дальше?',
    send: 'Отправить',
    stop: 'Остановить ход',
    submitHint: 'Ctrl+Enter',
    zoneLabel: 'Зона',
    modeLabel: 'Что агенту разрешено',
    modelLabel: 'Модель',
  },

  /** How much the agent may do — read twenty times a day, so it says what it does, not its name. */
  agentMode: {
    plan: {
      label: 'Сначала план',
      note: 'Читает и отвечает. Ничего не меняет на диске.',
    },
    acceptEdits: {
      label: 'Правит в своей зоне',
      note: 'Правит файлы внутри выбранной папки, не спрашивая.',
    },
    auto: {
      label: 'Сам решает',
      note: 'Правит и запускает команды сам. Границы — только папка.',
    },
  },

  /** The shell's own chrome: what the rail switches between. */
  nav: {
    conversation: 'Разговор',
    files: 'Файлы',
    ownership: 'Владение',
    settings: 'Настройки',
  },

  /** The settings screen. */
  settings: {
    title: 'Настройки',
    lead:
      'Эта страница ещё не нарисована — здесь только то, что переехало из титлбара, проект, папка ' +
      'и провайдеры.',
    folder: {
      title: 'Папка на этой машине',
      none: 'Папка не выбрана',
      change: 'Сменить',
    },
    view: {
      title: 'Вид',
      theme: 'Тема',
      themeDark: 'Тёмная',
      themeLight: 'Светлая',
      density: 'Плотность',
      densityComfortable: 'Просторная',
      densityCompact: 'Плотная',
    },
    providers: {
      title: 'Провайдеры',
    },
    team: {
      title: 'Команда',
      /** @param count how many people are in the project */
      count: (count: number): string => `${count} в проекте`,
      empty: 'Кто в проекте',
    },
    account: {
      title: 'Аккаунт',
      /** Said next to the name when the session is the machine's own, not a team hub's. */
      localNote: 'на этом компьютере',
      signOut: 'Выйти',
      joinTeam: 'Работать командой',
    },
  },

  /** First run: the folder, then the key. Both skippable, neither asks anything unanswerable. */
  firstRun: {
    region: 'Первый запуск',
    heading: 'Первый запуск',
    /**
     * @param step which step is on screen
     * @param total how many there are
     *
     * Takes `string | number` because `FirstRun` does its own substitution: the caller hands it
     * `progress('{step}', '{total}')` and the component fills the braces. Word order still belongs
     * to the translator, which is the only reason this is a function at all.
     */
    progress: (step: string | number, total: string | number): string => `Шаг ${step} из ${total}`,
    statusRegion: 'Ответ приложения',
    folder: {
      /** @param name the person's own name */
      title: (name: string): string => `${name}, покажи, где лежит код`,
      titleAnonymous: 'Покажи, где лежит код',
      body:
        'PartyCo смотрит на одну папку с проектом. Выбери её — дальше всё настроится по ходу ' +
        'работы, отдельного мастера не будет.',
      primary: 'Выбрать папку…',
      secondary: 'Меня позвали в проект команды',
      footnote:
        'Второй шаг — ключ провайдера. Его можно пропустить: без ключа приложение работает, просто ' +
        'агент не отвечает. «Меня позвали в проект команды» открывает вход на хаб команды — тот, ' +
        'адрес которого дал пригласивший; общий репозиторий на хабе пока не заводится.',
    },
    key: {
      title: 'Агент работает на твоём ключе',
      body:
        'Вставь ключ любого из провайдеров. Он останется на этой машине — хаб команды его не ' +
        'получит и не сможет получить.',
      providerGroup: 'Провайдер',
      field: 'Ключ',
      primary: 'Сохранить и начать',
      busy: 'Сохраняем…',
      skip: 'Пропустить — добавлю позже',
      whyDisabled: 'Кнопка включится, когда в поле появится ключ.',
      noProviders:
        'Ни одного провайдера, которому можно передать ключ, сейчас нет — сохранять его некуда. ' +
        'Этот шаг можно пропустить.',
    },
  },

  /** What the local hub says when it could not start. Three dead ends, three different exits. */
  localHub: {
    schemaTooNew:
      'Локальная база PartyCo сделана более новой версией программы, и эта её прочитать не может. ' +
      'Обнови PartyCo — или, если откатываешься намеренно, убери файл hub.db из папки данных: ' +
      'аккаунт и состав проекта создадутся заново, рабочая папка и история разговора не пострадают.',
    busy:
      'Локальная база PartyCo занята другим процессом. Скорее всего запущена вторая копия ' +
      'программы или собственный partycod — закрой её и открой PartyCo снова.',
    /** @param detail the OS's own words, which are the part a person can act on */
    portRefused: (detail: string): string =>
      'PartyCo не смог открыть локальный порт для своей служебной части. Обычно это делает ' +
      'антивирус или корпоративный firewall — разреши программе локальные соединения и запусти ' +
      `её снова. (${detail})`,
    /** @param detail the OS's own words */
    unknown: (detail: string): string =>
      `PartyCo не смог запустить свою служебную часть, поэтому войти не получится. (${detail})`,
    roleUnknown:
      'Локальный аккаунт PartyCo записан с ролью, которой эта версия программы не знает. Обнови ' +
      'PartyCo — или убери файл hub.db из папки данных, чтобы аккаунт создался заново.',
    unreachable:
      'Служебная часть PartyCo не ответила, поэтому локальный вход не состоялся. Перезапусти ' +
      'программу; если повторится — можно войти на хаб команды.',
  },
} as const;
