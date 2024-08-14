// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import TelemetryReporter from '@vscode/extension-telemetry';
import * as vscode from "vscode";
import { commands } from 'vscode';

import { CodeLensProvider } from "./codelensProvider";

import { CloseDescriptionCommand } from './commands/CloseDescriptionCommand';
import { EditPathsCommand } from './commands/EditPathsCommand';
import { FilterDescriptionCommand } from './commands/FilterDescriptionCommand';
import { GenerateClientCommand } from './commands/GenerateClientCommand';
import { GeneratedOutputState } from './commands/GeneratedOutputState';
import { KiotaStatusCommand } from "./commands/KiotaStatusCommand";
import { AddToSelectedEndpointsCommand } from './commands/open-api-tree-node/AddToSelectedEndpointsCommand';
import { OpenDocumentationPageCommand } from "./commands/open-api-tree-node/OpenDocumentationPageCommand";
import { RemoveAllFromSelectedEndpointsCommand } from './commands/open-api-tree-node/RemoveAllFromSelectedEndpointsCommand';
import { RemoveFromSelectedEndpointsCommand } from './commands/open-api-tree-node/RemoveFromSelectedEndpointsCommand';
import { RegenerateButtonCommand } from './commands/regenerate/RegenerateButtonCommand';
import { RegenerateCommand } from './commands/regenerate/RegenerateCommand';
import { SearchOrOpenApiDescriptionCommand } from './commands/SearchOrOpenApiDescriptionCommand';
import { updateStatusBarItem } from './utilities/status-bar';
import { UpdateClientsCommand } from './commands/UpdateClientsCommand';

import { dependenciesInfo, extensionId, statusBarCommandId, treeViewId } from "./constants";
import { DependenciesViewProvider } from "./dependenciesViewProvider";
import { getExtensionSettings } from "./extensionSettings";
import { ClientOrPluginProperties, KiotaLogEntry } from "./kiotaInterop";
import { OpenApiTreeNode, OpenApiTreeProvider } from "./openApiTreeProvider";
import { GenerateState } from "./steps";
import { loadLockFile, openTreeViewWithProgress } from './utilities/file';
import { loadTreeView } from "./workspaceTreeProvider";

let kiotaStatusBarItem: vscode.StatusBarItem;
let clientOrPluginKey: string;
let clientOrPluginObject: ClientOrPluginProperties;
let workspaceGenerationType: string;
let config: Partial<GenerateState>;


// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export async function activate(
  context: vscode.ExtensionContext
): Promise<void> {
  const openApiTreeProvider = new OpenApiTreeProvider(context, () => getExtensionSettings(extensionId));
  const dependenciesInfoProvider = new DependenciesViewProvider(
    context.extensionUri
  );

  const kiotaStatusCommand = new KiotaStatusCommand();
  const openDocumentationPageCommand = new OpenDocumentationPageCommand();
  const generateClientCommand = new GenerateClientCommand(context, openApiTreeProvider);
  const searchOrOpenApiDescriptionCommand = new SearchOrOpenApiDescriptionCommand(context, openApiTreeProvider);
  const closeDescriptionCommand = new CloseDescriptionCommand(openApiTreeProvider);
  const filterDescriptionCommand = new FilterDescriptionCommand(openApiTreeProvider);
  const editPathsCommand = new EditPathsCommand(openApiTreeProvider, clientOrPluginKey, clientOrPluginObject);
  const regenerateButtonCommand = new RegenerateButtonCommand(context, openApiTreeProvider, clientOrPluginKey, clientOrPluginObject, workspaceGenerationType);
  const regenerateCommand = new RegenerateCommand(context, openApiTreeProvider, clientOrPluginKey, clientOrPluginObject, workspaceGenerationType);
  const addToSelectedEndpointsCommand = new AddToSelectedEndpointsCommand(openApiTreeProvider);
  const addAllToSelectedEndpointsCommand = new AddToSelectedEndpointsCommand(openApiTreeProvider);
  const removeFromSelectedEndpointsCommand = new RemoveFromSelectedEndpointsCommand(openApiTreeProvider);
  const removeAllFromSelectedEndpointsCommand = new RemoveAllFromSelectedEndpointsCommand(openApiTreeProvider);
  const updateClientsCommand = new UpdateClientsCommand(context);

  const reporter = new TelemetryReporter(context.extension.packageJSON.telemetryInstrumentationKey);
  await loadTreeView(context);
  let codeLensProvider = new CodeLensProvider();
  const handleUri = async (uri: vscode.Uri) => {
    if (uri.path === "/") {
      return;
    }
    const queryParameters = getQueryParameters(uri);
    if (uri.path.toLowerCase() === "/opendescription") {
      reporter.sendTelemetryEvent("DeepLink.OpenDescription");
      const descriptionUrl = queryParameters["descriptionurl"];
      if (descriptionUrl) {
        await openTreeViewWithProgress(() => openApiTreeProvider.setDescriptionUrl(descriptionUrl));
        return;
      }
    }
    void vscode.window.showErrorMessage(
      vscode.l10n.t("Invalid URL, please check the documentation for the supported URLs")
    );
  };
  context.subscriptions.push(
    vscode.window.registerUriHandler({
      handleUri
    }),

    vscode.languages.registerCodeLensProvider('json', codeLensProvider),
    reporter,
    registerCommandWithTelemetry(reporter,
      `${extensionId}.selectLock`,
      (x) => loadLockFile(x, openApiTreeProvider)
    ),
    registerCommandWithTelemetry(reporter, statusBarCommandId, await kiotaStatusCommand.execute()),
    vscode.window.registerWebviewViewProvider(
      dependenciesInfo,
      dependenciesInfoProvider
    ),
    vscode.window.registerTreeDataProvider(treeViewId, openApiTreeProvider),
    registerCommandWithTelemetry(reporter, `${treeViewId}.openDocumentationPage`, (openApiTreeNode: OpenApiTreeNode) => openDocumentationPageCommand.execute(openApiTreeNode)),
    registerCommandWithTelemetry(reporter, `${treeViewId}.addToSelectedEndpoints`, (openApiTreeNode: OpenApiTreeNode) => addToSelectedEndpointsCommand.execute(openApiTreeNode)),
    registerCommandWithTelemetry(reporter, `${treeViewId}.addAllToSelectedEndpoints`, (openApiTreeNode: OpenApiTreeNode) => addAllToSelectedEndpointsCommand.execute(openApiTreeNode)),
    registerCommandWithTelemetry(reporter, `${treeViewId}.removeFromSelectedEndpoints`, (openApiTreeNode: OpenApiTreeNode) => removeFromSelectedEndpointsCommand.execute(openApiTreeNode)),
    registerCommandWithTelemetry(reporter, `${treeViewId}.removeAllFromSelectedEndpoints`, (openApiTreeNode: OpenApiTreeNode) => removeAllFromSelectedEndpointsCommand.execute(openApiTreeNode)),
    registerCommandWithTelemetry(reporter, `${treeViewId}.generateClient`, () => generateClientCommand.execute()),
    vscode.workspace.onDidChangeWorkspaceFolders(async () => {
      const generatedOutput = context.workspaceState.get<GeneratedOutputState>('generatedOutput');
      if (generatedOutput) {
        const { outputPath } = generatedOutput;
        await generateClientCommand.displayGenerationResults(config, outputPath);
        // Clear the state 
        void context.workspaceState.update('generatedOutput', undefined);
      }
    }),
    registerCommandWithTelemetry(reporter, `${treeViewId}.searchOrOpenApiDescription`, () => searchOrOpenApiDescriptionCommand.execute()),
    registerCommandWithTelemetry(reporter, `${treeViewId}.closeDescription`, () => closeDescriptionCommand.execute()),
    registerCommandWithTelemetry(reporter, `${treeViewId}.filterDescription`, () => filterDescriptionCommand.execute()),
    registerCommandWithTelemetry(reporter, `${extensionId}.editPaths`, async () => editPathsCommand.execute()),
    registerCommandWithTelemetry(reporter, `${treeViewId}.regenerateButton`, async () => regenerateButtonCommand.execute(config)),
    registerCommandWithTelemetry(reporter, `${extensionId}.regenerate`, async () => regenerateCommand.execute()),
  );

  // create a new status bar item that we can now manage
  kiotaStatusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100
  );
  kiotaStatusBarItem.command = statusBarCommandId;
  context.subscriptions.push(kiotaStatusBarItem);

  // update status bar item once at start
  await updateStatusBarItem(context, kiotaStatusBarItem);
  context.subscriptions.push(commands.registerCommand(`${extensionId}.updateClients`, async () => updateClientsCommand.execute(kiotaStatusBarItem)));
}


function registerCommandWithTelemetry(reporter: TelemetryReporter, command: string, callback: (...args: any[]) => any, thisArg?: any): vscode.Disposable {
  return vscode.commands.registerCommand(command, (...args: any[]) => {
    const splatCommand = command.split('/');
    const eventName = splatCommand[splatCommand.length - 1];
    reporter.sendTelemetryEvent(eventName);
    return callback.apply(thisArg, args);
  }, thisArg);
}

function getQueryParameters(uri: vscode.Uri): Record<string, string> {
  const query = uri.query;
  if (!query) {
    return {};
  }
  const queryParameters = (query.startsWith('?') ? query.substring(1) : query).split("&");
  const parameters = {} as Record<string, string>;
  queryParameters.forEach((element) => {
    const keyValue = element.split("=");
    parameters[keyValue[0].toLowerCase()] = decodeURIComponent(keyValue[1]);
  });
  return parameters;
}
async function checkForSuccess(results: KiotaLogEntry[]) {
  for (const result of results) {
    if (result && result.message) {
      if (result.message.includes("Generation completed successfully")) {
        void vscode.window.showInformationMessage('Generation completed successfully.');
      }
    }
  }
}


// This method is called when your extension is deactivated
export function deactivate() { }
