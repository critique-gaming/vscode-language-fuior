import * as vscode from "vscode";
import * as path from "path";
import fetch from "node-fetch";

async function notifyGame(endpoint) {
  const gameUrl = vscode.workspace.getConfiguration("fuior").get("gameServerURL");
  const url = `${gameUrl}${endpoint}`;
  try {
    const res = await fetch(url);
    const data = await res.json();

    if (data.error) {
      vscode.window.showErrorMessage(data.error);
    }
  } catch (err) {
    console.error(err);
    vscode.window.showErrorMessage(
      "Could not connect to the game. Make sure you are running it from Defold on this computer."
    );
  }
}
  
export function activateNotify(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand("fuior.runInGame", () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showErrorMessage("No fuior file is open");
        return;
      }

      const data = JSON.stringify({
        data: editor.document.getText(),
        filename: path.basename(editor.document.uri.fsPath),
        variables: vscode.workspace.getConfiguration("fuior").get("variableOverrides"),
      });

      const base64Encoded = Buffer.from(data, "utf8").toString("base64");

      notifyGame(`/load_fuior/${base64Encoded}`);
    })
  );
}