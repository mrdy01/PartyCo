import { mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { AGENT_PERMISSIONS, type AgentPermission } from '@partyco/agents';
import { platformPaths } from './platform.ts';

/**
 * What the member picked on the composer chips, kept between launches.
 *
 * A separate small file rather than a field on either of the two we already write, and both of those
 * were considered rather than ignored:
 *
 *  - `provider-keys.json` refuses to write at all when the OS will not encrypt, reads as empty when
 *    it cannot decrypt, and is deleted outright when the last key is forgotten. Those behaviours are
 *    right for a secret and wrong for a preference: a member on a machine with no keyring would lose
 *    their chip settings silently, and so would a member who removed their last API key. A chosen
 *    model is not a secret — it is four letters the vendor publishes.
 *  - `workspace.json` is entirely the chosen folder, and its version is bumped when that shape
 *    changes. Adding an unrelated concern would mean a future settings change invalidates the
 *    remembered folder.
 *
 * Scoped per member, not per folder. The transcript is keyed by normalised root because a
 * conversation belongs to a project; a model alias belongs to the member's own subscription and a
 * permission mode is a working habit, so keying either by folder would mean re-picking both on every
 * folder switch for nothing. The model map is keyed by provider, so a member with two providers
 * keeps two answers.
 *
 * **Validated on read, not only on write.** This is a plain-text file on the member's own disk, and
 * it is the one route by which a permission value could otherwise enter the product without passing
 * `parseRunRequest`. An `agentMode` edited to `bypassPermissions` reads back as `plan`. The adapter's
 * own lookup table would refuse it a second time; neither guard is load-bearing alone.
 */

const STATE_FILE = 'agent-settings.json';
const STATE_VERSION = 1;

export interface AgentSettings {
  agentMode: AgentPermission;
  /** Chosen model alias per provider id. A provider absent from the map means «выбирает CLI». */
  models: Readonly<Record<string, string>>;
}

/**
 * Plan, because it is the only mode that cannot surprise anybody.
 *
 * A first launch that defaulted to a writing mode would mean the very first turn a person ever sends
 * can change files they have not looked at, on the strength of a default they never chose.
 */
export const DEFAULT_AGENT_SETTINGS: AgentSettings = { agentMode: 'plan', models: {} };

/** The same shape `main/agents.ts` accepts on a run. Kept in step by the test, not by memory. */
const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$/;

function stateFile(): string {
  return join(platformPaths().config, STATE_FILE);
}

/**
 * Everything unrecognised becomes the default rather than an error.
 *
 * Same rule as `workspace.ts`: this runs at startup, and a half-written or hand-edited file must
 * cost the member one re-pick, never the app's ability to open.
 */
function sanitize(raw: unknown): AgentSettings {
  if (typeof raw !== 'object' || raw === null) return DEFAULT_AGENT_SETTINGS;
  const record = raw as Record<string, unknown>;
  if (record['version'] !== STATE_VERSION) return DEFAULT_AGENT_SETTINGS;

  const mode = record['agentMode'];
  const agentMode =
    typeof mode === 'string' && AGENT_PERMISSIONS.includes(mode as AgentPermission)
      ? (mode as AgentPermission)
      : DEFAULT_AGENT_SETTINGS.agentMode;

  const models: Record<string, string> = {};
  const rawModels = record['models'];
  if (typeof rawModels === 'object' && rawModels !== null) {
    for (const [providerId, value] of Object.entries(rawModels as Record<string, unknown>)) {
      if (typeof providerId !== 'string' || providerId.length === 0) continue;
      if (typeof value === 'string' && MODEL_ID.test(value)) models[providerId] = value;
    }
  }

  return { agentMode, models };
}

export async function readAgentSettings(): Promise<AgentSettings> {
  let raw: string;
  try {
    raw = await readFile(stateFile(), 'utf8');
  } catch {
    return DEFAULT_AGENT_SETTINGS;
  }
  try {
    return sanitize(JSON.parse(raw));
  } catch {
    return DEFAULT_AGENT_SETTINGS;
  }
}

/**
 * Temp file, `fsync`, rename — the same three steps and the same reasons as `workspace.ts`.
 *
 * Duplicated rather than lifted into a shared helper on purpose: the workspace write path is
 * load-bearing at startup, and refactoring it to share code with a preference file is a risk taken
 * for tidiness. If a third writer appears, that is the moment to lift it.
 */
export async function writeAgentSettings(next: AgentSettings): Promise<AgentSettings> {
  const settings = sanitize({ version: STATE_VERSION, ...next });
  const dir = platformPaths().config;
  await mkdir(dir, { recursive: true });

  const target = join(dir, STATE_FILE);
  const temp = join(dir, `${STATE_FILE}.${process.pid}.${Date.now().toString(36)}.tmp`);

  const handle = await open(temp, 'w');
  try {
    await handle.writeFile(
      `${JSON.stringify({ version: STATE_VERSION, ...settings, updatedAt: Date.now() }, null, 2)}\n`,
      'utf8',
    );
    await handle.sync();
  } finally {
    await handle.close();
  }

  try {
    for (let attempt = 0; ; attempt += 1) {
      try {
        await rename(temp, target);
        break;
      } catch (cause) {
        if (attempt >= 2) throw cause;
        await new Promise((done) => setTimeout(done, 25));
      }
    }
  } catch (cause) {
    await rm(temp, { force: true });
    throw cause;
  }

  return settings;
}

/** Exported for the test, which must exercise the same validation the app uses. */
export const __test = { sanitize, STATE_VERSION };
