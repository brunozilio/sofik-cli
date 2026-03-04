import fs from "fs";
import path from "path";
import os from "os";
import { loadSettings } from "../lib/settings.ts";

/**
 * Validates that a file path is within an allowed directory.
 * Throws an error if the path traverses outside allowed roots.
 */
export function validateFilePath(filePath: string): void {
  const rawRoots = [
    process.cwd(),
    os.homedir(),
    os.tmpdir(),
    "/tmp",
    ...( loadSettings().additionalDirectories ?? []),
  ];

  // Resolve each root, following symlinks (handles macOS /var → /private/var)
  const allowedRoots = rawRoots.map((d) => {
    try { return fs.realpathSync(path.resolve(d)); } catch { return path.resolve(d); }
  });

  // For existing files/dirs, resolve symlinks
  let resolved: string;
  try {
    resolved = fs.realpathSync(filePath);
  } catch {
    // File doesn't exist yet — walk up to first existing parent to resolve symlinks
    let candidate = path.resolve(filePath);
    let parent = path.dirname(candidate);
    // Walk up directory chain to find an existing path we can realpathSync
    let resolvedParent = parent;
    while (parent !== path.dirname(parent)) {
      try {
        resolvedParent = fs.realpathSync(parent);
        break;
      } catch {
        parent = path.dirname(parent);
      }
    }
    // Reconstruct the full path using the real parent
    const relativeTail = path.relative(parent, candidate);
    resolved = path.join(resolvedParent, relativeTail);
  }

  const isAllowed = allowedRoots.some(
    (root) => resolved === root || resolved.startsWith(root + path.sep)
  );

  if (!isAllowed) {
    throw new Error(
      `Path traversal denied: "${filePath}" resolves outside allowed directories. ` +
      `Allowed roots: ${allowedRoots.join(", ")}`
    );
  }
}
