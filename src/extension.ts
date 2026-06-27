import * as vscode from 'vscode';
import { InkEditorProvider } from './InkEditorProvider';

export function activate(context: vscode.ExtensionContext): void {
  const provider = new InkEditorProvider(context);

  const command = vscode.commands.registerCommand(
    'scribblemd.open',
    (uri?: vscode.Uri) => provider.open(uri),
  );

  context.subscriptions.push(command, provider);
}

export function deactivate(): void {
  /* noop */
}
