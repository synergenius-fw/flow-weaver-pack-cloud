/**
 * Path resolution with traversal protection for the tunnel.
 *
 * Virtual paths from Studio (e.g. `/workflow.ts`) are resolved to absolute
 * filesystem paths within the workspace root.
 */
import * as path from 'node:path';

/**
 * Resolve a Studio virtual path to an absolute filesystem path.
 * Blocks null bytes and path traversal.
 */
export function resolvePath(workspaceRoot: string, studioPath: string): string {
  if (studioPath.includes('\0')) {
    throw new Error('Path traversal blocked');
  }

  // If the path is already absolute and within the workspace, allow it
  if (studioPath.startsWith(workspaceRoot + path.sep) || studioPath === workspaceRoot) {
    const resolved = path.resolve(studioPath);
    if (!resolved.startsWith(workspaceRoot + path.sep) && resolved !== workspaceRoot) {
      throw new Error('Path traversal blocked');
    }
    return resolved;
  }

  // Normalize backslashes to forward slashes (Windows clients may send them)
  let normalized = studioPath.replace(/\\/g, '/');

  // Strip /cloud prefix if present
  if (normalized.startsWith('/cloud')) {
    normalized = normalized.slice('/cloud'.length);
  }

  // Strip leading slashes
  normalized = normalized.replace(/^\/+/, '');

  if (!normalized) {
    return workspaceRoot;
  }

  const resolved = path.resolve(workspaceRoot, normalized);

  // Block path traversal
  if (!resolved.startsWith(workspaceRoot + path.sep) && resolved !== workspaceRoot) {
    throw new Error('Path traversal blocked');
  }

  return resolved;
}

/** Convert an absolute filesystem path to a Studio virtual path. */
export function toVirtualPath(workspaceRoot: string, realPath: string): string {
  const rel = path.relative(workspaceRoot, realPath);
  if (rel.startsWith('..')) {
    return '/' + path.basename(realPath);
  }
  return '/' + rel.replace(/\\/g, '/');
}
