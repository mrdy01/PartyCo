import type { Dictionary } from './index.tsx';

/**
 * The English dictionary.
 *
 * Annotated with `Dictionary` rather than inferred, and that annotation is the whole safety net: a
 * key missing here, misspelled here, or left behind after `ru.ts` renamed one is a type error at
 * `npm run check`. Nobody has to notice.
 *
 * Translated, not transliterated. Where Russian says «Правит в своей зоне» the English is not
 * «Edits in its zone» — the point of the phrase is the boundary, so it says «Edits inside the
 * folder». The product's voice in Russian is plain, direct and slightly blunt; the English aims at
 * the same register rather than at a formal one.
 */
export const EN: Dictionary = {
  common: {
    cancel: 'Cancel',
    close: 'Close',
    open: 'Open',
    change: 'Change',
    add: 'Add',
    ready: 'Done',
  },

  language: {
    title: 'Language',
    label: 'Interface language',
    note: 'Switches immediately, remembered between launches.',
  },

  composer: {
    placeholder: 'What next?',
    fieldLabel: 'What next?',
    send: 'Send',
    stop: 'Stop the turn',
    submitHint: 'Ctrl+Enter',
    zoneLabel: 'Zone',
    modeLabel: "What the agent may do",
    modelLabel: 'Model',
  },

  agentMode: {
    plan: {
      label: 'Plan first',
      note: 'Reads and answers. Changes nothing on disk.',
    },
    acceptEdits: {
      label: 'Edits inside the folder',
      note: 'Edits files inside the chosen folder without asking.',
    },
    auto: {
      label: 'Decides for itself',
      note: 'Edits and runs commands on its own. The folder is the only boundary.',
    },
  },

  nav: {
    conversation: 'Conversation',
    files: 'Files',
    ownership: 'Ownership',
    settings: 'Settings',
  },

  settings: {
    title: 'Settings',
    lead:
      'This page has not been designed yet — it holds what moved out of the title bar, plus the ' +
      'project, the folder and the providers.',
    folder: {
      title: 'Folder on this machine',
      none: 'No folder chosen',
      change: 'Change',
    },
    view: {
      title: 'Appearance',
      theme: 'Theme',
      themeDark: 'Dark',
      themeLight: 'Light',
      density: 'Density',
      densityComfortable: 'Comfortable',
      densityCompact: 'Compact',
    },
    providers: {
      title: 'Providers',
    },
    team: {
      title: 'Team',
      count: (count: number): string =>
        count === 1 ? '1 person in the project' : `${count} people in the project`,
      empty: "Who's in the project",
    },
    account: {
      title: 'Account',
      localNote: 'on this computer',
      signOut: 'Sign out',
      joinTeam: 'Work as a team',
    },
  },

  firstRun: {
    region: 'First run',
    heading: 'First run',
    progress: (step: string | number, total: string | number): string => `Step ${step} of ${total}`,
    statusRegion: 'Application response',
    folder: {
      title: (name: string): string => `${name}, show me where the code lives`,
      titleAnonymous: 'Show me where the code lives',
      body:
        'PartyCo looks at one project folder. Choose it — everything else is set up as you go, ' +
        'there is no separate wizard.',
      primary: 'Choose a folder…',
      secondary: 'I was invited to a team project',
      footnote:
        'Step two is a provider key. It can be skipped: without one the app works, the agent just ' +
        'does not answer. "I was invited to a team project" opens the sign-in for a team hub — the ' +
        'address whoever invited you gave you; a shared repository on the hub does not exist yet.',
    },
    key: {
      title: 'The agent runs on your key',
      body:
        'Paste a key for any of the providers. It stays on this machine — the team hub does not ' +
        'receive it and cannot.',
      providerGroup: 'Provider',
      field: 'Key',
      primary: 'Save and start',
      busy: 'Saving…',
      skip: 'Skip — I will add it later',
      whyDisabled: 'The button turns on once there is a key in the field.',
      noProviders:
        'There is no provider to hand a key to right now, so there is nowhere to save it. This ' +
        'step can be skipped.',
    },
  },

  localHub: {
    schemaTooNew:
      "PartyCo's local database was written by a newer version of the app and this one cannot read " +
      'it. Update PartyCo — or, if you are downgrading on purpose, remove hub.db from the data ' +
      'folder: the account and project roster are recreated, the working folder and the ' +
      'conversation history are untouched.',
    busy:
      "PartyCo's local database is held by another process. Most likely a second copy of the app " +
      'or your own partycod is running — close it and open PartyCo again.',
    portRefused: (detail: string): string =>
      'PartyCo could not open a local port for its service half. This is usually antivirus or a ' +
      `corporate firewall — allow the app local connections and start it again. (${detail})`,
    unknown: (detail: string): string =>
      `PartyCo could not start its service half, so signing in will not work. (${detail})`,
    roleUnknown:
      "PartyCo's local account carries a role this version does not know. Update PartyCo — or " +
      'remove hub.db from the data folder so the account is created again.',
    unreachable:
      "PartyCo's service half did not answer, so the local sign-in did not happen. Restart the " +
      'app; if it happens again, you can sign in to a team hub instead.',
  },
};
