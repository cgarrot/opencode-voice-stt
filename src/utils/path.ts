import { homedir } from "node:os";
import { isAbsolute, resolve } from "node:path";

export const expandHome = (path: string): string => {
  if (path === "~") return homedir();
  if (path.startsWith("~/")) return resolve(homedir(), path.slice(2));
  return path;
};

export const resolvePath = (path: string, cwd = process.cwd()): string => {
  const expanded = expandHome(path);
  return isAbsolute(expanded) ? expanded : resolve(cwd, expanded);
};
