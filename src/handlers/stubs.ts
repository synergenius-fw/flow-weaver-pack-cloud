/**
 * Stub handlers. Methods that return sensible defaults for operations
 * not supported in tunnel mode.
 */
import * as os from 'node:os';
import type { HandlerMap } from '../dispatch.js';

const stub =
  <T>(value: T) =>
  () =>
    Promise.resolve(value);
const lazyStub =
  <T>(fn: () => T) =>
  () =>
    Promise.resolve(fn());

export const stubHandlers: HandlerMap = {
  // --- Completions / Quick Info ---
  getCompletions: stub([]),
  getQuickInfo: stub(undefined),

  // --- Snapshots (undo/redo state is client-side) ---
  takeWorkflowSnapshot: stub({ success: true }),
  deleteWorkflowSnapshot: stub({ success: true }),
  deleteAllWorkflowSnapshots: stub({ success: true }),
  cleanupOldWorkflowSnapshots: stub({ success: true }),
  loadWorkflowSnapshot: stub(null),
  getLatestWorkflowSnapshot: stub(null),
  getWorkflowSnapshotAtIndex: stub(null),
  findCommonBaseSnapshot: stub(null),
  listWorkflowSnapshots: stub([]),

  // --- Backups ---
  createBackup: stub({ success: true }),
  listBackups: stub([]),
  restoreBackup: stub({ success: true }),
  deleteBackup: stub({ success: true }),
  cleanupOldBackups: stub({ success: true }),

  // --- Deployment profiles / project config ---
  listDeploymentProfiles: stub([]),
  readDeploymentProfile: stub(null),
  readProjectConfig: stub(null),
  writeDeploymentProfile: stub({ success: true }),
  deleteDeploymentProfile: stub({ success: true }),
  setActiveDeploymentProfile: stub({ success: true }),
  writeProjectConfig: stub({ success: true }),

  // --- Export ---
  exportWorkflow: stub({ success: true }),
  exportMultiWorkflow: stub({ success: true }),
  exportNodeTypes: stub({ success: true }),
  exportBundle: stub({ success: true }),

  // --- Misc ---
  getUserDataPath: lazyStub(() => os.tmpdir()),
  getTempDirectory: lazyStub(() => os.tmpdir()),
  openDirectoryInExplorer: stub({ success: true }),
  checkDeployPrerequisites: stub({ success: true }),
  appendToLog: stub(undefined),
  getMatchingFileList: stub([]),
  generateAnnotationSuggestion: stub(null),
  addWorkflowToFile: stub({ success: true }),
  removeWorkflowFromFile: stub({ success: true }),
  toggleWorkflowExportInFile: stub({ success: true }),
  getAvailableNodeTypesInFile: stub([]),
  scanProjectBundleItems: stub([]),
  getAvailableItemsInWorkdir: stub([]),
  getAvailableItemsInFiles: stub([]),
  getWorkflowEndpointInfo: stub(null),
  callTool: stub(undefined),
  getTypedPackages: stub([]),
  getPackageExports: stub([]),
  warmUpWorkflowCache: stub(undefined),
  preBundleWorkflow: stub(undefined),
  getLocalFunctionCode: stub(null),
  evaluateExpression: stub(undefined),
  interruptExecution: stub({ success: false }),
  setWatcher: stub({ success: true }),
  stopWatcher: stub({ success: true }),

  // --- Marketplace ---
  marketplaceSearch: stub({ results: [] }),
  marketplaceListInstalled: stub([]),
  marketplaceInstall: stub({ success: true }),

  // --- Patterns ---
  getPatterns: stub([]),
  applyPatternToWorkflow: stub({ success: true }),
  extractPatternFromWorkflow: stub({ success: true }),

  // --- Plugins ---
  initializePlugins: stub(undefined),
  cleanupPlugins: stub(undefined),
  getPlugins: stub([]),
  getPluginSystemStatus: stub({ status: 'ready' }),
  callPlugin: stub(undefined),

  // --- Git (stubbed; git ops go through cloud server, not tunnel) ---
  getRepository: stub({}),
  gitInit: stub({}),
  gitClone: stub({}),
  gitStatus: stub({
    files: [],
    modified: [],
    not_added: [],
    created: [],
    deleted: [],
    renamed: [],
    conflicted: [],
    ignored: [],
    current: 'main',
  }),
  gitCommit: stub({ success: true }),
  gitPush: stub({ success: true }),
  gitPull: stub({ success: true }),
  gitFetch: stub({ success: true }),
  gitStageFiles: stub({ success: true }),
  gitGetWorkingDiff: stub({ success: true }),
  gitHistory: stub({ success: true }),
  gitGetCommitFiles: stub({ success: true }),
  gitGetCommitDiff: stub({ success: true }),
  gitGetFileAtCommit: stub({ success: true }),
  gitBranchList: stub({ success: true, branches: ['main'], current: 'main' }),
  gitBranchCreate: stub({ success: true }),
  gitBranchCheckout: stub({ success: true }),
  gitTagCreate: stub({ success: true }),
  gitTagDelete: stub({ success: true }),
  gitStashSave: stub({ success: true }),
  gitStashApply: stub({ success: true }),
  gitRemoteAdd: stub({ success: true }),
  gitRemoteFetch: stub({ success: true }),
  gitMerge: stub({ success: true }),
  gitReset: stub({ success: true }),
  gitTagList: stub({ success: true, tags: [] }),
  gitStashList: stub({ success: true, stashes: [] }),
  gitRemoteList: stub({ success: true, remotes: [] }),
  gitRepoList: stub([]),

  // --- Terminal (not supported in tunnel mode) ---
  createTerminal: stub({ success: false, error: 'Terminal not supported in tunnel mode' }),
  writeToTerminal: stub({ success: false }),
  resizeTerminal: stub({ success: false }),
  closeTerminal: stub({ success: false }),
  pauseTerminal: stub({ success: false }),
  resumeTerminal: stub({ success: false }),
  listTerminals: stub([]),

  // --- Debug ---
  debugCreateSession: stub(undefined),
  debugEndSession: stub(undefined),
  debugSetBreakpoints: stub(undefined),
  debugResume: stub(undefined),
  debugStepOver: stub(undefined),
  debugStepInto: stub(undefined),
  debugStepOut: stub(undefined),
  debugEvaluateExpression: stub(undefined),
  debugInspectVariable: stub(undefined),

  // --- Doctor ---
  runDoctor: stub({
    status: 'healthy',
    checks: [],
    summary: { passed: 0, failed: 0, warnings: 0 },
  }),
  runDoctorChecks: stub({
    status: 'healthy',
    checks: [],
    summary: { passed: 0, failed: 0, warnings: 0 },
  }),
};
