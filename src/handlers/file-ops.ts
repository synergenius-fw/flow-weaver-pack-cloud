/**
 * File operation handlers for the tunnel.
 */
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { resolvePath, toVirtualPath } from '../path-resolver.js';
import type { HandlerMap, TunnelContext } from '../dispatch.js';

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', '.next', '.cache', '.claude']);
const SKIP_FILES = new Set(['package-lock.json']);

interface FileInfo {
  path: string;
  type: 'file' | 'directory';
}

async function collectFileInfos(dir: string, root: string): Promise<FileInfo[]> {
  const results: FileInfo[] = [];

  async function walk(currentDir: string): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(currentDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
      if (SKIP_FILES.has(entry.name)) continue;
      const fullPath = path.join(currentDir, entry.name);
      const isDir = entry.isDirectory();
      results.push({
        path: toVirtualPath(root, fullPath),
        type: isDir ? 'directory' : 'file',
      });
      if (isDir) {
        await walk(fullPath);
      }
    }
  }

  await walk(dir);
  return results;
}

export const fileOpsHandlers: HandlerMap = {
  getCWD: async () => '/',

  findProjectRoot: async () => '/',

  getFile: async (params, ctx) => {
    const filePath = params.filePath as string;
    if (!filePath) throw new Error('filePath is required');
    const resolved = resolvePath(ctx.workspaceRoot, filePath);
    return fs.readFile(resolved, 'utf-8');
  },

  writeFile: async (params, ctx) => {
    const filePath = (params.filePath || params.path) as string;
    const content = (params.content ?? params.source ?? params.text) as string;
    if (!filePath) throw new Error('filePath is required');
    if (content === undefined || content === null) throw new Error('content is required');
    const resolved = resolvePath(ctx.workspaceRoot, filePath);
    await fs.mkdir(path.dirname(resolved), { recursive: true });
    await fs.writeFile(resolved, content, 'utf-8');
    return { saved: true };
  },

  saveFile: async (params, ctx) => {
    return fileOpsHandlers.writeFile!(params, ctx);
  },

  hasFile: async (params, ctx) => {
    const filePath = params.filePath as string;
    if (!filePath) return false;
    const resolved = resolvePath(ctx.workspaceRoot, filePath);
    try {
      await fs.access(resolved);
      return true;
    } catch {
      return false;
    }
  },

  deleteFile: async (params, ctx) => {
    const filePath = params.filePath as string;
    if (!filePath) throw new Error('filePath is required');
    const resolved = resolvePath(ctx.workspaceRoot, filePath);
    await fs.unlink(resolved);
    return { deleted: true };
  },

  getFilesStructure: async (_params, ctx) => {
    return collectFileInfos(ctx.workspaceRoot, ctx.workspaceRoot);
  },

  getFilesStructureRecursive: async (_params, ctx) => {
    return collectFileInfos(ctx.workspaceRoot, ctx.workspaceRoot);
  },

  listDirectory: async (params, ctx) => {
    let dirPath = (params.dirPath || params.path || params.directory) as string | undefined;
    if (dirPath?.startsWith('/cloud')) dirPath = dirPath.slice('/cloud'.length) || undefined;
    const resolved =
      dirPath && dirPath !== '/' && dirPath !== ''
        ? resolvePath(ctx.workspaceRoot, dirPath)
        : ctx.workspaceRoot;

    const entries = await fs.readdir(resolved, { withFileTypes: true });
    const results = [];
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name === 'package-lock.json') continue;
      const fullPath = path.join(resolved, entry.name);
      const stat = await fs.stat(fullPath);
      const isDir = entry.isDirectory();
      results.push({
        name: entry.name,
        path: toVirtualPath(ctx.workspaceRoot, fullPath),
        type: isDir ? 'directory' : 'file',
        isDirectory: isDir,
        size: stat.size,
        modified: stat.mtime.toISOString(),
      });
    }
    return results;
  },

  findWorkflows: async (_params, ctx) => {
    const entries = await fs.readdir(ctx.workspaceRoot, { withFileTypes: true });
    const paths: string[] = [];
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith('.ts')) {
        paths.push('/' + entry.name);
      }
    }
    return paths;
  },

  createFolder: async (params, ctx) => {
    const dirPath = params.dirPath as string;
    if (!dirPath) throw new Error('dirPath is required');
    const resolved = resolvePath(ctx.workspaceRoot, dirPath);
    await fs.mkdir(resolved, { recursive: true });
    return { created: true };
  },

  renameFile: async (params, ctx) => {
    const oldPath = params.oldPath as string;
    const newPath = params.newPath as string;
    if (!oldPath || !newPath) throw new Error('oldPath and newPath are required');
    const resolvedOld = resolvePath(ctx.workspaceRoot, oldPath);
    const resolvedNew = resolvePath(ctx.workspaceRoot, newPath);
    await fs.rename(resolvedOld, resolvedNew);
    return { renamed: true };
  },

  getFileStats: async (params, ctx) => {
    const filePath = params.filePath as string;
    if (!filePath) throw new Error('filePath is required');
    const resolved = resolvePath(ctx.workspaceRoot, filePath);
    const stat = await fs.stat(resolved);
    return {
      size: stat.size,
      created: stat.birthtime.toISOString(),
      modified: stat.mtime.toISOString(),
      isFile: stat.isFile(),
      isDirectory: stat.isDirectory(),
    };
  },

  hasFolder: async () => true,
  deleteDirectory: async () => ({ success: true }),
  moveFile: async () => ({ success: true }),
  copyFile: async () => ({ success: true }),
  copyDirectory: async () => ({ success: true }),

  checkLibraryStatus: async (_params: Record<string, unknown>, ctx: TunnelContext) => {
    try {
      const pkgPath = path.join(
        ctx.workspaceRoot,
        'node_modules',
        '@synergenius',
        'flow-weaver',
        'package.json',
      );
      const raw = await fs.readFile(pkgPath, 'utf-8');
      const pkg = JSON.parse(raw);
      return {
        installed: true,
        compatible: true,
        corrupt: false,
        outdated: false,
        version: pkg.version,
        issues: [],
        capabilities: {},
      };
    } catch {
      return {
        installed: false,
        compatible: false,
        corrupt: false,
        outdated: false,
        version: null,
        issues: ['@synergenius/flow-weaver not installed in project'],
        capabilities: {},
      };
    }
  },

  getPackages: async (_params: Record<string, unknown>, ctx: TunnelContext) => {
    try {
      const raw = await fs.readFile(path.join(ctx.workspaceRoot, 'package.json'), 'utf-8');
      const pkg = JSON.parse(raw);
      const deps = pkg.dependencies || {};
      return Object.entries(deps).map(([name, version]) => ({ name, version }));
    } catch {
      return [];
    }
  },
};
