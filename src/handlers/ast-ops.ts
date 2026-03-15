/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * AST read-operation handlers for the tunnel.
 * Uses the @synergenius/flow-weaver parser and validator as peer dependencies.
 *
 * Handler params are untyped JSON from the tunnel protocol.
 * The library functions validate internally, so we use `any` throughout.
 */
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { parser, resolveNpmNodeTypes } from '@synergenius/flow-weaver';
import { validateWorkflow } from '@synergenius/flow-weaver/api';
import { resolvePath, toVirtualPath } from '../path-resolver.js';
import type { HandlerMap } from '../dispatch.js';

type WorkflowAST = any;

function ensureASTDefaults(ast: WorkflowAST): WorkflowAST {
  return {
    ...ast,
    instances: ast.instances ?? [],
    connections: ast.connections ?? [],
    nodeTypes: ast.nodeTypes ?? [],
  };
}

function virtualizeASTPaths(ast: WorkflowAST, wsPath: string): WorkflowAST {
  const result = { ...ast };

  if (typeof result.sourceFile === 'string' && result.sourceFile.startsWith(wsPath)) {
    result.sourceFile = toVirtualPath(wsPath, result.sourceFile);
  }

  if (Array.isArray(result.nodeTypes)) {
    result.nodeTypes = result.nodeTypes.map((nt: any) => {
      const copy = { ...nt };
      if (copy.sourceLocation?.file?.startsWith(wsPath)) {
        copy.sourceLocation = {
          ...copy.sourceLocation,
          file: toVirtualPath(wsPath, copy.sourceLocation.file),
        };
      }
      if (typeof copy.path === 'string' && copy.path.startsWith(wsPath)) {
        copy.path = toVirtualPath(wsPath, copy.path);
      }
      return copy;
    });
  }

  if (Array.isArray(result.instances)) {
    result.instances = result.instances.map((inst: any) => {
      if (inst.sourceLocation?.file?.startsWith(wsPath)) {
        return {
          ...inst,
          sourceLocation: {
            ...inst.sourceLocation,
            file: toVirtualPath(wsPath, inst.sourceLocation.file),
          },
        };
      }
      return inst;
    });
  }

  return result;
}

export function prepareMutationResult(ast: WorkflowAST, wsPath: string): WorkflowAST {
  return virtualizeASTPaths(ensureASTDefaults(ast), wsPath);
}

export function getWorkflowName(params: Record<string, unknown>): string | undefined {
  return (params.functionName || params.workflowName || params.exportName) as string | undefined;
}

// ---------------------------------------------------------------------------
// Core AST operations
// ---------------------------------------------------------------------------

async function loadWorkflowAST(filePath: string, functionName?: string): Promise<WorkflowAST> {
  const parsed = parser.parse(filePath);
  const workflows: WorkflowAST[] = parsed.workflows || [];
  if (workflows.length === 0) {
    throw new Error(`No workflows found in ${filePath}`);
  }
  const target = functionName
    ? workflows.find((w: WorkflowAST) => w.functionName === functionName)
    : workflows[0];
  if (!target) {
    throw new Error(`Workflow "${functionName}" not found in ${filePath}`);
  }
  return resolveNpmNodeTypes(target, path.dirname(filePath));
}

async function loadAllWorkflowsAST(
  wsPath: string,
): Promise<Array<{ filePath: string; ast: WorkflowAST }>> {
  const entries = await fs.readdir(wsPath, { withFileTypes: true });
  const results: Array<{ filePath: string; ast: WorkflowAST }> = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.ts')) continue;
    if (entry.name === 'tsconfig.json' || entry.name === 'package.json') continue;
    const fullPath = path.join(wsPath, entry.name);
    try {
      const parsed = parser.parse(fullPath);
      const workflows: WorkflowAST[] = parsed.workflows || [];
      for (const wf of workflows) {
        const resolved = await resolveNpmNodeTypes(wf, wsPath);
        results.push({ filePath: fullPath, ast: resolved });
      }
    } catch {
      // Skip files that fail to parse
    }
  }
  return results;
}

function parseWorkflowFromContent(content: string): Array<{ name: string; ast: WorkflowAST }> {
  const parsed = parser.parseFromString(content);
  const workflows: WorkflowAST[] = parsed.workflows || [];
  return workflows.map((wf: WorkflowAST) => ({
    name: wf.name || wf.functionName || '',
    ast: wf,
  }));
}

function getDiagnostics(source: string) {
  const parsed = parser.parseFromString(source);
  if ((parsed.errors && parsed.errors.length > 0) || !parsed.workflows?.length) {
    return {
      valid: false,
      errors: (parsed.errors || []).map((e: unknown) => ({
        message: typeof e === 'string' ? e : (e as { message?: string }).message || String(e),
      })),
      warnings: [],
    };
  }

  const allErrors: Array<{ message: string; location?: unknown }> = [];
  const allWarnings: Array<{ message: string; location?: unknown }> = [];
  for (const wf of parsed.workflows) {
    const result = validateWorkflow(wf);
    if (result.errors) allErrors.push(...result.errors);
    if (result.warnings) allWarnings.push(...result.warnings);
  }
  return { valid: allErrors.length === 0, errors: allErrors, warnings: allWarnings };
}

async function extractAllNodeTypes(wsPath: string) {
  const all = await loadAllWorkflowsAST(wsPath);
  const typeMap = new Map<string, unknown>();
  for (const { ast } of all) {
    for (const nt of ast.nodeTypes || []) {
      if (!typeMap.has(nt.name)) {
        typeMap.set(nt.name, nt);
      }
    }
  }
  return Array.from(typeMap.values());
}

// ---------------------------------------------------------------------------
// Exported handlers
// ---------------------------------------------------------------------------

export const astOpsHandlers: HandlerMap = {
  loadWorkflowAST: async (params, ctx) => {
    const filePath = params.filePath as string;
    if (!filePath) throw new Error('filePath is required');
    const functionName = getWorkflowName(params);
    const resolved = resolvePath(ctx.workspaceRoot, filePath);
    const ast = await loadWorkflowAST(resolved, functionName);
    return virtualizeASTPaths(ensureASTDefaults(ast), ctx.workspaceRoot);
  },

  loadAllWorkflowsAST: async (_params, ctx) => {
    const all = await loadAllWorkflowsAST(ctx.workspaceRoot);
    return all.map(({ filePath, ast }) => ({
      filePath: toVirtualPath(ctx.workspaceRoot, filePath),
      ast: virtualizeASTPaths(ensureASTDefaults(ast), ctx.workspaceRoot),
    }));
  },

  parseWorkflowASTFromContent: async (params) => {
    const content = params.content as string;
    if (!content) throw new Error('content is required');
    const functionName = getWorkflowName(params);
    const results = parseWorkflowFromContent(content);
    if (functionName) {
      const match = results.find(
        (r) => r.name === functionName || r.ast?.functionName === functionName,
      );
      return match ? ensureASTDefaults(match.ast) : null;
    }
    return results.length > 0 ? ensureASTDefaults(results[0].ast) : null;
  },

  getAvailableWorkflowsInFile: async (params, ctx) => {
    const filePath = params.filePath as string;
    if (!filePath) return { availableWorkflows: [] };
    try {
      const resolved = resolvePath(ctx.workspaceRoot, filePath);
      const source = await fs.readFile(resolved, 'utf-8');
      const results = parseWorkflowFromContent(source);
      return {
        availableWorkflows: results.map((w) => ({
          name: w.ast?.name || w.name,
          functionName: w.ast?.functionName || w.name,
          isExported: true,
        })),
      };
    } catch {
      return { availableWorkflows: [] };
    }
  },

  getDiagnostics: async (params, ctx) => {
    let source: string | undefined;
    const openFiles = params.openFiles as Record<string, string> | undefined;
    const filePath = params.filePath as string | undefined;

    if (openFiles && filePath && openFiles[filePath]) {
      source = openFiles[filePath];
    } else if (typeof params.content === 'string') {
      source = params.content;
    } else if (filePath) {
      const resolved = resolvePath(ctx.workspaceRoot, filePath);
      source = await fs.readFile(resolved, 'utf-8');
    }
    if (!source) throw new Error('No source provided for diagnostics');

    const { errors, warnings } = getDiagnostics(source);
    const result: Array<{ severity: string; message: string; start: unknown }> = [];
    for (const e of errors) {
      result.push({
        severity: 'error',
        message: e.message || String(e),
        start: (e as { location?: unknown }).location ?? { line: 1, column: 0 },
      });
    }
    for (const w of warnings) {
      result.push({
        severity: 'warning',
        message: w.message || String(w),
        start: (w as { location?: unknown }).location ?? { line: 1, column: 0 },
      });
    }
    return result;
  },

  getNodeTypes: async (_params, ctx) => {
    const types = await extractAllNodeTypes(ctx.workspaceRoot);
    return (types as Array<{ name: string }>).map((t) => ({
      name: t.name,
      label: t.name,
      nodeType: t,
    }));
  },

  getNodeTypesBatch: async (params, ctx) => {
    const cursor = (params.cursor as string) || '0';
    const limit = (params.limit as number) || 50;
    const offset = parseInt(cursor, 10) || 0;
    const types = await extractAllNodeTypes(ctx.workspaceRoot);
    const all = (types as Array<{ name: string }>).map((t) => ({
      name: t.name,
      label: t.name,
      nodeType: t,
    }));
    const page = all.slice(offset, offset + limit);
    const nextCursor = offset + limit < all.length ? String(offset + limit) : null;
    return { types: page, cursor: nextCursor };
  },

  searchNodeTypes: async (params, ctx) => {
    const query = ((params.query as string) || '').toLowerCase();
    const types = await extractAllNodeTypes(ctx.workspaceRoot);
    const all = (types as Array<{ name: string }>).map((t) => ({
      name: t.name,
      label: t.name,
      nodeType: t,
    }));
    if (!query) return all;
    return all.filter(
      (t) => t.name.toLowerCase().includes(query) || t.label.toLowerCase().includes(query),
    );
  },
};
