import { readFile, rename, rm, writeFile } from "node:fs/promises";
import { objectFrom, textFrom } from "../utils/coerce";
import { deepMerge } from "../utils/merge";
import { resolvePath } from "../utils/path";
import { formatError } from "../utils/text";

/**
 * Named profiles are partial configs deep-merged over the base config, like
 * modes but persistent: the last selected profile is stored in a sidecar
 * state file (<configPath>.profile.json) and reused as the default for every
 * session that reads the same config file.
 */
export const DEFAULT_PROFILE = "default";

/** Sidecar state file path for a config file (empty when no config path). */
export const profileStatePath = (configPath: string): string =>
  configPath ? `${configPath}.profile.json` : "";

/** Available profile names: "default" plus the user-defined ones. */
export const listProfileNames = (fileConfig: Record<string, unknown>): string[] =>
  Array.from(new Set([DEFAULT_PROFILE, ...Object.keys(objectFrom(fileConfig.profiles))]));

/** Whether a profile name is known (user-defined or "default"). */
export const isKnownProfile = (fileConfig: Record<string, unknown>, name: string): boolean =>
  listProfileNames(fileConfig).includes(name);

/**
 * Resolve the override object for a profile. "default" and unknown names yield
 * an empty override so the base config is used unchanged.
 */
export const profileOverrideFrom = (fileConfig: Record<string, unknown>, name: string): Record<string, unknown> => {
  if (!name || name === DEFAULT_PROFILE) return {};
  return objectFrom(objectFrom(fileConfig.profiles)[name]);
};

/**
 * Merge a profile override onto the base config. Regular keys deep-merge, but
 * `provider` and `capture` are discriminated unions: when the override changes
 * their `type`, the whole block is replaced so base fields (endpoint, model,
 * apiKey…) never leak into the new provider/capture.
 */
export const applyProfileOverride = (
  base: Record<string, unknown>,
  override: Record<string, unknown>,
): Record<string, unknown> => {
  const result = deepMerge(base, override);
  for (const key of ["provider", "capture"] as const) {
    const baseBlock = objectFrom(base[key]);
    const overrideBlock = objectFrom(override[key]);
    if (Object.keys(overrideBlock).length === 0) continue;
    const baseType = textFrom(baseBlock.type);
    const overrideType = textFrom(overrideBlock.type);
    if (baseType && overrideType && baseType !== overrideType) {
      result[key] = overrideBlock;
    }
  }
  return result;
};

const readStateFile = async (path: string): Promise<Record<string, unknown>> => {
  try {
    return objectFrom(JSON.parse(await readFile(resolvePath(path), "utf8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw new Error(`Cannot parse STT profile state ${path}: ${formatError(error)}`);
  }
};

/** Read the persisted profile name; "" when the state file is missing. */
export const readProfileState = async (configPath: string): Promise<string> => {
  const statePath = profileStatePath(configPath);
  if (!statePath) return "";
  return textFrom((await readStateFile(statePath)).profile);
};

/**
 * Persist the active profile name atomically (temp file + rename). No-op when
 * there is no config path. Throws when the state file cannot be written.
 */
export const writeProfileState = async (configPath: string, profile: string): Promise<void> => {
  const statePath = profileStatePath(configPath);
  if (!statePath) return;
  const resolved = resolvePath(statePath);
  const tempPath = `${resolved}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tempPath, `${JSON.stringify({ profile }, null, 2)}\n`, "utf8");
  try {
    await rename(tempPath, resolved);
  } catch (error) {
    await rm(tempPath, { force: true });
    throw error;
  }
};

/**
 * Resolve the effective profile name for a session:
 * explicit env override > persisted last selection > config `profile` key > "default".
 */
export const resolveEffectiveProfile = async (options: {
  configPath: string;
  envProfile?: string;
  configProfile?: string;
}): Promise<string> => {
  const explicit = textFrom(options.envProfile);
  if (explicit) return explicit;
  const persisted = await readProfileState(options.configPath).catch(() => "");
  if (persisted) return persisted;
  return textFrom(options.configProfile, DEFAULT_PROFILE);
};
