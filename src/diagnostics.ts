import * as vscode from "vscode";
import debounce = require("lodash.debounce");
import { chunk, DebouncedFunc } from "lodash";
import * as path from "path";
import * as cp from "child_process";

class DiagnosticHandler {
  document: vscode.TextDocument;
  fuiorDiagnostics: vscode.DiagnosticCollection;

  pending: boolean = false;
  requested: boolean = false;
  debounced: DebouncedFunc<() => void>;

  lastUri: string;
  exePath: string | null;
  headerPath: string | null;

  constructor(
    doc: vscode.TextDocument,
    fuiorDiagnosics: vscode.DiagnosticCollection
  ) {
    this.document = doc;
    this.fuiorDiagnostics = fuiorDiagnosics;
    this.debounced = debounce(() => {
      if (this.pending) {
        this.requested = true;
        return;
      }
      this.run();
    }, 500);
  }

  async findSubdir(pathComponents: string[]): Promise<string | null> {
    let fsPath = this.document.uri.fsPath;
    if (!fsPath) return null;
    while (true) {
      const dirname = path.dirname(fsPath);
      if (dirname === fsPath) break;
      fsPath = dirname;

      const exePath = path.join(dirname, ...pathComponents);

      try {
        await vscode.workspace.fs.stat(vscode.Uri.file(exePath));
        return exePath;
      } catch (ex) {}
    }
  }

  async getLinterPath(): Promise<string | null> {
    let osname: string = process.platform;
    let extension: string = "";
    if (osname.startsWith("darwin")) {
      osname = "Darwin";
    } else if (osname.startsWith("win")) {
      osname = "Windows";
      extension = ".exe.";
    } else if (osname.startsWith("linux")) {
      osname = "Linux";
    }

    return await this.findSubdir([
      "deploy",
      "config",
      "hooks",
      "fuior",
      "bin",
      osname,
      "fuior" + extension,
    ]);
  }

  async getHeaderPath(): Promise<string | null> {
    const path = await this.findSubdir(["config.fui"]);
    if (path === this.document.uri.fsPath) return null;
    return path;
  }

  async runLinter() {
    if (this.lastUri !== this.document.uri.toString()) {
      this.lastUri = this.document.uri.toString();
      this.exePath = await this.getLinterPath();
      this.headerPath = await this.getHeaderPath();
    }

    if (!this.exePath) return;

    const fuiorArgs = ["-", "--no-generate", "--error-ranges"];

    if (this.headerPath) {
      fuiorArgs.push("--header");
      fuiorArgs.push(this.headerPath);
    }

    const linterOutput = await new Promise<string>((resolve, reject) => {
      const sp = cp.spawn(this.exePath, fuiorArgs, {
        stdio: ["pipe", "ignore", "pipe"],
      });

      sp.on("error", reject);

      const chunks = [];
      sp.stderr.on("data", (data) => {
        chunks.push(data);
      });

      try {
        sp.stdin.write(Buffer.from(this.document.getText(), "utf-8"));
        sp.stdin.end();
      } catch (ex) {}

      sp.stderr.on("error", reject);
      sp.stderr.on("end", () => {
        resolve(Buffer.concat(chunks).toString("utf-8"));
      });
    });

    if (!this.pending) return;

    const diagnostics: vscode.Diagnostic[] = [];

    linterOutput.split("\n").forEach((line) => {
      const match = line.match(
        /(WARNING|ERROR): stdin:([0-9]+):([0-9]+)\-([0-9]+):([0-9]+) (.*)/
      );
      if (!match) return;

      const errorType = match[1];
      const startRow = parseInt(match[2]) - 1;
      const startColumn = parseInt(match[3]) - 1;
      const endRow = parseInt(match[4]) - 1;
      const endColumn = parseInt(match[5]) - 1;
      const message = match[6];

      diagnostics.push(
        new vscode.Diagnostic(
          new vscode.Range(startRow, startColumn, endRow, endColumn),
          message,
          errorType === "ERROR"
            ? vscode.DiagnosticSeverity.Error
            : vscode.DiagnosticSeverity.Warning
        )
      );
    });

    this.fuiorDiagnostics.set(this.document.uri, diagnostics);
  }

  async run() {
    this.pending = true;
    this.requested = false;

    try {
      await this.runLinter();
    } catch (ex) {
      console.error("Error running linter: ", ex);
    }

    this.pending = false;
    if (this.requested) {
      this.run();
    }
  }

  refresh() {
    this.debounced();
  }

  cancel() {
    this.requested = false;
    this.pending = false;
    this.debounced.cancel();
  }
}

export function refreshDiagnostics(
  doc: vscode.TextDocument,
  fuiorDiagnostics: vscode.DiagnosticCollection,
  handlers: Map<vscode.TextDocument, DiagnosticHandler>,
): void {
  if (doc.languageId !== "fuior") return;
  let handler = handlers.get(doc);
  if (!handler) {
    handler = new DiagnosticHandler(doc, fuiorDiagnostics);
    handlers.set(doc, handler);
  }
  handler.refresh();
}

export const subscribeToDocumentChanges = (
  context: vscode.ExtensionContext
) => {
  const fuiorDiagnostics = vscode.languages.createDiagnosticCollection("fuior");
  context.subscriptions.push(fuiorDiagnostics);

  const handlers = new Map<vscode.TextDocument, DiagnosticHandler>();

  if (vscode.window.activeTextEditor) {
    refreshDiagnostics(
      vscode.window.activeTextEditor.document,
      fuiorDiagnostics,
      handlers
    );
  }
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor) {
        refreshDiagnostics(editor.document, fuiorDiagnostics, handlers);
      }
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((e) =>
      refreshDiagnostics(e.document, fuiorDiagnostics, handlers)
    )
  );

  context.subscriptions.push(
    vscode.workspace.onDidCloseTextDocument((doc) => {
      fuiorDiagnostics.delete(doc.uri);
      handlers.get(doc)?.cancel();
    })
  );
};
