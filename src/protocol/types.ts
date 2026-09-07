// ZCode Protocol v4 — measured 2026-09-07 (docs/protocol.md).
// Exact strings from /opt/ZCode/resources/glm/zcode.cjs — do not "fix" them.

export const V4_METHODS = {
  connectionFlow: "v4/connection/flow",
  controllerSubscribe: "v4/controller/subscribe",
  controllerResync: "v4/controller/resync",
  controllerUnsubscribe: "v4/controller/unsubscribe",
  conversationSubscribe: "v4/conversation/subscribe",
  conversationResync: "v4/conversation/resync",
  conversationUnsubscribe: "v4/conversation/unsubscribe",
  conversationRowsRange: "v4/conversation/rowsRange",
  conversationPlans: "v4/conversation/plans",
  conversationFileChanges: "v4/conversation/fileChanges",
  conversationFileRewindPreview: "v4/conversation/fileRewindPreview",
  usageStats: "v4/usage/stats",
  conversationUsage: "v4/conversation/usage",
  attachmentBegin: "v4/attachment/begin",
  attachmentChunk: "v4/attachment/chunk",
  attachmentCommit: "v4/attachment/commit",
  attachmentAbort: "v4/attachment/abort",
  attachmentRead: "v4/attachment/read",
  attachmentPreviewSource: "v4/attachment/previewSource",
  commandsQuery: "v4/commands/query",
  command: "v4/command",
} as const;

export type V4Method = (typeof V4_METHODS)[keyof typeof V4_METHODS];

// Server→client pushes observed live (no requestId).
export type ServerNotificationMethod =
  | "v4/conversation/frame"
  | "v4/telemetry/event"
  | "v4/command_fact"
  | "v4/fork_start_failure"
  | "v4/cua/permission-observation";

export interface WireMessage {
  method: string;
  params?: unknown;
  // JSON-RPC-flavored: requests carry id (number|string); server→client
  // requests use "server-<n>" ids. Responses: {id, result} | {id, error}.
  id?: number | string;
  result?: unknown;
  error?: { code: number | string; message?: string; data?: unknown };
  [k: string]: unknown;
}

// Second registry: the app-server's primary session API (exact strings).
export const SESSION_METHODS = {
  computerUseOperationEvent: "computer-use/operation-event",
  sessionCreate: "session/create",
  sessionResume: "session/resume",
  sessionList: "session/list",
  sessionSubagents: "session/subagents",
  sessionRequestRuntimePreferences: "session/requestRuntimePreferences",
  sessionRead: "session/read",
  sessionMessages: "session/messages",
  sessionEvents: "session/events",
  sessionSubscribe: "session/subscribe",
  sessionSend: "session/send",
  sessionStop: "session/stop",
  sessionCancelBackgroundTask: "session/cancelBackgroundTask",
  sessionFork: "session/fork",
  sessionCompact: "session/compact",
  sessionGoal: "session/goal",
  sessionClose: "session/close",
  sessionSetModel: "session/setModel",
  sessionSetThoughtLevel: "session/setThoughtLevel",
  sessionUpdateRuntimeModelConfig: "session/updateRuntimeModelConfig",
  sessionSetMode: "session/setMode",
  workspaceReadState: "workspace/readState",
  workspaceHookTrustGrant: "workspace/hooks/trustGrant",
  workspaceUpdateProviderRegistry: "workspace/updateProviderRegistry",
  workspaceUpdateInteractionPreferences: "workspace/updateInteractionPreferences",
  workspaceUpdateModelIoPreferences: "workspace/updateModelIoPreferences",
  workspaceUpsertModelProvider: "workspace/upsertModelProvider",
  workspaceRemoveModelProvider: "workspace/removeModelProvider",
  workspaceSetDefaultModel: "workspace/setDefaultModel",
  workspaceSetDefaultThoughtLevel: "workspace/setDefaultThoughtLevel",
  workspaceSetDefaultMode: "workspace/setDefaultMode",
  workspaceGenerateText: "workspace/generateText",
  workspaceCancelGenerateText: "workspace/cancelGenerateText",
  mcpList: "mcp/list",
  pluginsList: "plugins/list",
  pluginsReferenceCatalog: "plugins/referenceCatalog",
  skillsReferenceCatalog: "skills/referenceCatalog",
  pluginsResolveSuggestedReference: "plugins/resolveSuggestedReference",
  pluginsSetEnabled: "plugins/setEnabled",
  pluginsOverview: "plugins/overview",
  pluginsMarketplaceAdd: "plugins/marketplace/add",
  pluginsMarketplaceRemove: "plugins/marketplace/remove",
  pluginsMarketplaceUpdate: "plugins/marketplace/update",
  pluginsInstall: "plugins/install",
  pluginsCancelOperation: "plugins/cancelOperation",
  pluginsUninstall: "plugins/uninstall",
  pluginsUpdate: "plugins/update",
  pluginsRestoreBuiltin: "plugins/restoreBuiltin",
  pluginsConfigure: "plugins/configure",
  pluginsResetConfig: "plugins/resetConfig",
  pluginsValidate: "plugins/validate",
  pluginsDescribe: "plugins/describe",
  automationCreate: "automation/create",
  automationUpdate: "automation/update",
  automationCheckTaskBinding: "automation/checkTaskBinding",
  automationList: "automation/list",
  automationDelete: "automation/delete",
  usageStats: "usage/stats",
  sessionUsage: "session/usage",
  interactionRequestPermission: "interaction/requestPermission",
  interactionRequestUserInput: "interaction/requestUserInput",
  interactionRequestProviderRuntimeHeaders: "interaction/requestProviderRuntimeHeaders",
  interactionRequestOfficialMcpAuthHeaders: "interaction/requestOfficialMcpAuthHeaders",
  interactionBrowserList: "interaction/browserList",
  interactionBrowserExecute: "interaction/browserExecute",
} as const;

// JSON-RPC error codes seen in the server's client-request machinery.
export const ERROR_CODES = {
  noClientAttached: -32020,
  clientRequestCancelled: -32021,
  clientRequestTimedOut: -32022,
} as const;
