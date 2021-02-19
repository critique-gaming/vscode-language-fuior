import { ExtensionContext } from "vscode";
import { activateDiagnostics } from "./diagnostics";
import { activateNotify } from "./notify";
import { activateSyntax } from "./syntax";

// Extension activation
export function activate(context: ExtensionContext) {
  activateSyntax(context);
  activateDiagnostics(context);
  activateNotify(context);
}
