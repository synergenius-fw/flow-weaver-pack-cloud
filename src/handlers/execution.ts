/**
 * Execution handlers for the tunnel.
 * executeFile, compileFile, generateDiagram
 */
import * as fs from 'node:fs/promises';
import { compileWorkflow } from '@synergenius/flow-weaver/api';
import { resolvePath } from '../path-resolver.js';
import type { HandlerMap } from '../dispatch.js';

let sourceToSVG: ((source: string, options?: Record<string, unknown>) => string) | undefined;

async function loadDiagram() {
  if (sourceToSVG) return sourceToSVG;
  try {
    const mod = await import('@synergenius/flow-weaver/diagram');
    sourceToSVG = mod.sourceToSVG;
    return sourceToSVG;
  } catch {
    return undefined;
  }
}

export const executionHandlers: HandlerMap = {
  executeFile: async (params, ctx) => {
    const filePath = params.filePath as string;
    if (!filePath) throw new Error('filePath is required');
    const resolved = resolvePath(ctx.workspaceRoot, filePath);
    const inputData = (params.inputData || params.input || {}) as Record<string, unknown>;
    try {
      const { executeWorkflowFromFile } = await import('@synergenius/flow-weaver/executor');
      const result = await executeWorkflowFromFile(resolved, inputData);
      return result;
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },

  compileFile: async (params, ctx) => {
    const filePath = params.filePath as string;
    if (!filePath) throw new Error('filePath is required');
    const resolved = resolvePath(ctx.workspaceRoot, filePath);
    try {
      const result = await compileWorkflow(resolved);
      return result;
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },

  generateDiagram: async (params, ctx) => {
    const filePath = params.filePath as string | undefined;
    const content = params.content as string | undefined;
    let source: string;

    if (content) {
      source = content;
    } else if (filePath) {
      const resolved = resolvePath(ctx.workspaceRoot, filePath);
      source = await fs.readFile(resolved, 'utf-8');
    } else {
      throw new Error('filePath or content is required');
    }

    const render = await loadDiagram();
    if (!render) {
      return { success: false, error: 'Diagram module not available' };
    }

    try {
      const svg = render(source, {
        workflowName: params.workflowName as string | undefined,
      });
      return { success: true, svg };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },
};
