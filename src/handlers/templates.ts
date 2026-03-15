/**
 * Template operation handlers for the tunnel.
 */
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { parser } from '@synergenius/flow-weaver';
import {
  getAllWorkflowTemplates,
  getWorkflowTemplate,
  type WorkflowTemplate,
} from '@synergenius/flow-weaver/cli';
import { resolvePath } from '../path-resolver.js';
import type { HandlerMap } from '../dispatch.js';

function mapTemplate(t: WorkflowTemplate) {
  return {
    id: t.id,
    name: t.name,
    description: t.description,
    category: t.category,
    ...(t.configSchema ? { configSchema: t.configSchema } : {}),
  };
}

export const templateHandlers: HandlerMap = {
  listTemplates: async (params) => {
    const type = (params.type as string) || 'workflow';
    if (type === 'node') return { templates: [] }; // Node templates not in public API
    const templates = getAllWorkflowTemplates();
    return { templates: templates.map(mapTemplate) };
  },

  getTemplate: async (params) => {
    const type = (params.type as string) || 'workflow';
    if (type === 'node') return null;
    const id = params.id as string;
    if (!id) throw new Error('id is required');
    const template = getWorkflowTemplate(id);
    return template ? mapTemplate(template) : null;
  },

  getTemplatePreviewAST: async (params) => {
    const templateId = params.templateId as string;
    if (!templateId) return { ast: null };
    const template = getWorkflowTemplate(templateId);
    if (!template) return { ast: null };
    try {
      const code = template.generate({ workflowName: 'preview' });
      const parsed = parser.parseFromString(code);
      const workflows = parsed.workflows || [];
      return { ast: workflows[0] || null };
    } catch {
      return { ast: null };
    }
  },

  generateWorkflowCode: async (params) => {
    const templateId = params.templateId as string;
    const workflowName = params.workflowName as string;
    if (!templateId || !workflowName) throw new Error('templateId and workflowName are required');
    const template = getWorkflowTemplate(templateId);
    if (!template) throw new Error(`Template "${templateId}" not found`);
    const options: Record<string, unknown> = { workflowName };
    if (params.async !== undefined) options.async = params.async;
    if (params.config) options.config = params.config;
    const code = template.generate(options as never);
    return { code };
  },

  generateNodeCode: async () => {
    // Node templates not available in public API
    return { code: '' };
  },

  getNodeTemplatePreview: async () => {
    return null;
  },

  createWorkflowFromTemplate: async (params, ctx) => {
    const templateId = params.templateId as string;
    const workflowName = params.workflowName as string;
    const fileName = params.fileName as string | undefined;
    if (!templateId || !workflowName) throw new Error('templateId and workflowName are required');
    const template = getWorkflowTemplate(templateId);
    if (!template) throw new Error(`Template "${templateId}" not found`);
    const genOpts: Record<string, unknown> = { workflowName };
    if (params.async !== undefined) genOpts.async = params.async;
    if (params.config) genOpts.config = params.config;
    const code = template.generate(genOpts as never);
    const targetFileName = fileName || `${workflowName}.ts`;
    const resolved = resolvePath(ctx.workspaceRoot, targetFileName);
    await fs.mkdir(path.dirname(resolved), { recursive: true });
    await fs.writeFile(resolved, code, 'utf-8');
    return { success: true, filePath: '/' + targetFileName };
  },
};
