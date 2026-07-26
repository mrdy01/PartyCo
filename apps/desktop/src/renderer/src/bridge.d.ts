import type { PartyCoBridge } from '../../preload/index.ts';

declare global {
  interface Window {
    partyco: PartyCoBridge;
  }
}

export {};
