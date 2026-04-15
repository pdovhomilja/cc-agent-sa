import path from "node:path";

export function safeResolve(root: string, relative: string): string {
  if (relative.includes("\0")) {
    throw new Error(`Rejected path: contains null byte`);
  }
  if (path.isAbsolute(relative)) {
    throw new Error(`Rejected path: absolute paths not allowed: ${relative}`);
  }
  const absRoot = path.resolve(root);
  const absolute = path.resolve(absRoot, relative);
  if (absolute !== absRoot && !absolute.startsWith(absRoot + path.sep)) {
    throw new Error(`Rejected path: resolves outside wiki root: ${relative}`);
  }
  return absolute;
}
