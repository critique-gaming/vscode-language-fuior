import { ExtensionContext } from "vscode";
import { activateDiagnostics } from "./diagnostics";
import { activateSyntax } from "./syntax";

// Extension activation
export function activate(context: ExtensionContext) {
  activateSyntax(context);
  activateDiagnostics(context);
}
