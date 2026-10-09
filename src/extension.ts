import * as vscode from 'vscode';
import { PinListWebview } from './PinListWebview';
import { PinDetailPanel } from './PinDetailPanel';

export function activate(context: vscode.ExtensionContext) {
  const list = new PinListWebview(context.extensionUri);

  context.subscriptions.push(
    vscode.commands.registerCommand('juejin-pins.openView', () => {
      const panel = vscode.window.createWebviewPanel(
        'juejin-pins',
        '掘金沸点',
        vscode.ViewColumn.One,
        { enableScripts: true, retainContextWhenHidden: true }
      );
      list.attach(panel.webview);
      panel.onDidDispose(() => {
        list.detach();
      });
    })
  );
}

export function deactivate() {}