/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Workflow mutation handlers for the tunnel.
 * Uses @synergenius/flow-weaver manipulation API as peer dependency.
 *
 * Handler params are untyped JSON from the tunnel protocol.
 * The library functions validate internally, so we use `any` throughout.
 */
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { parser, resolveNpmNodeTypes } from '@synergenius/flow-weaver';
import {
  generateInPlace,
  addNode,
  removeNode,
  updateNode,
  renameNode,
  setNodePosition,
  setNodeMinimized,
  setNodeSize,
  addConnection,
  removeConnection,
  addNodeType,
  removeNodeType,
  renameNodeType,
  updateNodeType,
  setStartExitPorts,
  setInstancePortConfigs,
} from '@synergenius/flow-weaver/api';
import { resolvePath } from '../path-resolver.js';
import { withFileLock } from '../file-lock.js';
import { prepareMutationResult, getWorkflowName } from './ast-ops.js';
import type { HandlerFn, HandlerMap, TunnelContext } from '../dispatch.js';

// Use `any` for workflow data — these are JSON blobs flowing between
// the tunnel client and cloud server. The library functions validate internally.

type WF = any;

// ---------------------------------------------------------------------------
// Core mutation engine
// ---------------------------------------------------------------------------

interface MutateOptions {
  filePath: string;
  functionName?: string;
  mutator: (wf: WF) => WF;
}

async function mutateWorkflowFile({ filePath, functionName, mutator }: MutateOptions) {
  return withFileLock(filePath, async () => {
    const sourceCode = await fs.readFile(filePath, 'utf-8');
    const parsed = parser.parse(filePath);
    const workflows: WF[] = parsed.workflows || [];

    if (workflows.length === 0) {
      throw new Error(`No workflows found in ${filePath}`);
    }

    const targetIndex = functionName
      ? workflows.findIndex((w: WF) => w.functionName === functionName)
      : 0;

    if (targetIndex < 0) {
      throw new Error(`Workflow "${functionName}" not found in ${filePath}`);
    }

    const original = workflows[targetIndex];
    const updated = mutator(original);

    // Preserve importSource for node types through mutation
    const importSourceMap = new Map<string, unknown>();
    for (const nt of original.nodeTypes || []) {
      if (nt.importSource) {
        importSourceMap.set(nt.name, nt.importSource);
      }
    }

    const updatedNodeTypes = (updated.nodeTypes || []).map((nt: WF) => {
      if (!nt.importSource && importSourceMap.has(nt.name)) {
        return { ...nt, importSource: importSourceMap.get(nt.name) };
      }
      return nt;
    });

    // Re-append node types that existed in original but are missing after mutation
    const updatedTypeNames = new Set(updatedNodeTypes.map((nt: WF) => nt.name));
    const missingTypes: WF[] = [];
    for (const nt of original.nodeTypes || []) {
      if (!updatedTypeNames.has(nt.name)) {
        missingTypes.push(nt);
      }
    }

    const workflowForGeneration = {
      ...updated,
      nodeTypes: [...updatedNodeTypes, ...missingTypes],
    };

    const result = generateInPlace(sourceCode, workflowForGeneration);
    await fs.writeFile(filePath, result.code, 'utf-8');
    return resolveNpmNodeTypes(updated, path.dirname(filePath));
  });
}

// ---------------------------------------------------------------------------
// Handler factory
// ---------------------------------------------------------------------------

function makeMutationHandler(
  extractMutator: (params: Record<string, unknown>) => (wf: WF) => WF,
): HandlerFn {
  return async (params: Record<string, unknown>, ctx: TunnelContext) => {
    const filePath = params.filePath as string;
    if (!filePath) throw new Error('filePath is required');
    const functionName = getWorkflowName(params);
    const resolved = resolvePath(ctx.workspaceRoot, filePath);
    const result = await mutateWorkflowFile({
      filePath: resolved,
      functionName,
      mutator: extractMutator(params),
    });
    return prepareMutationResult(result, ctx.workspaceRoot);
  };
}

// ---------------------------------------------------------------------------
// Exported handlers
// ---------------------------------------------------------------------------

export const mutationHandlers: HandlerMap = {
  addNode: makeMutationHandler((params) => {
    let node: WF = params.node;
    if (!node) {
      node = {
        type: 'NodeInstance',
        id: params.nodeName as string,
        nodeType: params.nodeType as string,
        ...(params.position && { position: params.position }),
      };
    }
    return (wf) => addNode(wf, node);
  }),

  removeNode: makeMutationHandler((params) => {
    const nodeId = (params.nodeName || params.nodeId) as string;
    if (!nodeId) throw new Error('nodeId is required');
    return (wf) => removeNode(wf, nodeId, { removeConnections: true });
  }),

  updateNode: makeMutationHandler((params) => {
    const nodeId = (params.nodeId || params.nodeName) as string;
    const updates = params.updates;
    if (!nodeId) throw new Error('nodeId is required');
    return (wf) => updateNode(wf, nodeId, updates);
  }),

  renameNode: makeMutationHandler((params) => {
    const oldId = params.oldId as string;
    const newId = params.newId as string;
    if (!oldId || !newId) throw new Error('oldId and newId are required');
    return (wf) => renameNode(wf, oldId, newId);
  }),

  setNodePosition: makeMutationHandler((params) => {
    const nodeId = params.nodeId as string;
    const x = params.x as number;
    const y = params.y as number;
    return (wf) => setNodePosition(wf, nodeId, x, y);
  }),

  setNodePositions: makeMutationHandler((params) => {
    const positions = params.positions as Array<{ nodeId: string; x: number; y: number }>;
    if (!positions) throw new Error('positions are required');
    return (wf) => {
      let result = wf;
      for (const { nodeId, x, y } of positions) {
        result = setNodePosition(result, nodeId, x, y);
      }
      return result;
    };
  }),

  setNodeMinimized: makeMutationHandler((params) => {
    const nodeId = params.nodeId as string;
    const minimized = params.minimized as boolean;
    return (wf) => setNodeMinimized(wf, nodeId, minimized);
  }),

  setNodeSize: makeMutationHandler((params) => {
    const nodeId = params.nodeId as string;
    const width = params.width as number;
    const height = params.height as number;
    return (wf) => setNodeSize(wf, nodeId, width, height);
  }),

  setNodeLabel: makeMutationHandler((params) => {
    const nodeId = params.nodeId as string;
    const label = params.label as string;
    return (wf) => updateNode(wf, nodeId, { label } as any);
  }),

  addNodes: makeMutationHandler((params) => {
    const nodes = params.nodes as WF[];
    if (!nodes) throw new Error('nodes are required');
    return (wf) => {
      let result = wf;
      for (const node of nodes) {
        result = addNode(result, node);
      }
      return result;
    };
  }),

  removeNodes: makeMutationHandler((params) => {
    const nodeIds = params.nodeIds as string[];
    if (!nodeIds) throw new Error('nodeIds are required');
    return (wf) => {
      let result = wf;
      for (const nodeId of nodeIds) {
        result = removeNode(result, nodeId, { removeConnections: true });
      }
      return result;
    };
  }),

  addConnection: makeMutationHandler((params) => {
    const from = params.from || { node: params.fromNode, port: params.fromPort };
    const to = params.to || { node: params.toNode, port: params.toPort };
    return (wf) => addConnection(wf, from as any, to as any);
  }),

  removeConnection: makeMutationHandler((params) => {
    const from = params.from || { node: params.fromNode, port: params.fromPort };
    const to = params.to || { node: params.toNode, port: params.toPort };
    return (wf) => removeConnection(wf, from as any, to as any);
  }),

  setConnections: makeMutationHandler((params) => {
    const connections = params.connections;
    return (wf) => ({ ...wf, connections });
  }),

  addConnections: makeMutationHandler((params) => {
    const connections = params.connections as WF[];
    return (wf: WF) => ({
      ...wf,
      connections: [...(wf.connections || []), ...connections],
    });
  }),

  updateNodePortConfig: makeMutationHandler((params) => {
    const nodeId = params.nodeId as string;
    const portName = params.portName as string;
    const portConfig = params.portConfig as Record<string, unknown>;
    return (wf) => {
      const instances = wf.instances || [];
      const node = instances.find((n: WF) => n.id === nodeId);
      if (!node) throw new Error(`Node "${nodeId}" not found`);
      const config = node.config || {};
      const existing = config.portConfigs || [];
      const idx = existing.findIndex((pc: WF) => pc.portName === portName);
      const updated = [...existing];
      if (idx >= 0) {
        updated[idx] = { ...updated[idx], ...portConfig };
      } else {
        updated.push({ portName, ...portConfig });
      }
      return updateNode(wf, nodeId, { config: { ...config, portConfigs: updated } });
    };
  }),

  resetNodePortConfig: makeMutationHandler((params) => {
    const nodeId = params.nodeId as string;
    const portName = params.portName as string;
    return (wf) => {
      const instances = wf.instances || [];
      const node = instances.find((n: WF) => n.id === nodeId);
      if (!node) throw new Error(`Node "${nodeId}" not found`);
      const config = node.config || {};
      const existing = config.portConfigs || [];
      const filtered = existing.filter((pc: WF) => pc.portName !== portName);
      return updateNode(wf, nodeId, { config: { ...config, portConfigs: filtered } });
    };
  }),

  updateInstancePortConfigs: makeMutationHandler((params) => {
    const instanceId = params.instanceId as string;
    const portConfigs = params.portConfigs;
    return (wf) => setInstancePortConfigs(wf, instanceId, portConfigs as any);
  }),

  updateWorkflowPorts: makeMutationHandler((params) => {
    const nodeType = params.nodeType as string;
    const ports = params.ports;
    return (wf) => setStartExitPorts(wf, nodeType as any, ports as any);
  }),

  addNodeType: makeMutationHandler((params) => {
    const nodeType = params.nodeType;
    return (wf) => addNodeType(wf, nodeType as any);
  }),

  removeNodeType: makeMutationHandler((params) => {
    const typeName = params.typeName as string;
    if (!typeName) throw new Error('typeName is required');
    return (wf) => removeNodeType(wf, typeName);
  }),

  renameNodeType: makeMutationHandler((params) => {
    const oldTypeName = params.oldTypeName as string;
    const newTypeName = params.newTypeName as string;
    return (wf) => renameNodeType(wf, oldTypeName, newTypeName);
  }),

  updateNodeType: makeMutationHandler((params) => {
    const typeName = params.typeName as string;
    const updates = params.updates;
    return (wf) => updateNodeType(wf, typeName, updates as any);
  }),

  setNodeTypes: makeMutationHandler((params) => {
    const nodeTypes = params.nodeTypes;
    return (wf) => ({ ...wf, nodeTypes });
  }),

  saveWorkflowState: makeMutationHandler((params) => {
    const workflow = params.workflow;
    return () => workflow;
  }),

  setNodeParent: makeMutationHandler((params) => {
    const nodeId = params.nodeId as string;
    const parentId = params.parentId as string;
    return (wf) => updateNode(wf, nodeId, { parent: parentId } as any);
  }),

  setNodesParent: makeMutationHandler((params) => {
    const nodeIds = params.nodeIds as string[];
    const parentId = params.parentId as string;
    return (wf) => {
      let result = wf;
      for (const nodeId of nodeIds) {
        result = updateNode(result, nodeId, { parent: parentId } as any);
      }
      return result;
    };
  }),

  setCurrentWorkflow: async () => ({ success: true }),

  setWorkflowForceAsync: makeMutationHandler((params) => {
    const forceAsync = params.forceAsync as boolean;
    return (wf) => ({ ...wf, forceAsync });
  }),
};
