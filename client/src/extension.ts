import * as path from "path";
import * as fs from "fs";
import { spawn, ChildProcess } from "child_process";
import * as vscode from "vscode";
import {
	LanguageClient,
	LanguageClientOptions,
	ServerOptions,
	TransportKind
} from "vscode-languageclient";
import { TaskProvider } from './tasks';

let client: LanguageClient;
let taskProvider: TaskProvider;

export function activate(context: vscode.ExtensionContext) {
	let serverModule = context.asAbsolutePath(path.join("server", "out", "server.js"));
	let debugOptions = { execArgv: ["--nolazy", "--inspect=6009"] };

	let serverOptions: ServerOptions = {
		run: { module: serverModule, transport: TransportKind.ipc },
		debug: {
			module: serverModule,
			transport: TransportKind.ipc,
			options: debugOptions
		}
	};

	if (!isValidCompilerPath()) {
		showNeedCompilerPath();
	}

	if ((vscode.workspace.getConfiguration("pawn").get("compileOptions") as string[]).length == 0) {
		vscode.workspace.getConfiguration("pawn").update("compileOptions", [ "-d0", "-O3" ], true);
	}

	let clientOptions: LanguageClientOptions = {
		documentSelector: [{ scheme: "file", language: "pawn" }],
		synchronize: {
			fileEvents: vscode.workspace.createFileSystemWatcher("**/.clientrc")
		},
		initializationOptions: {
			compiler: {
				path: vscode.workspace.getConfiguration("pawn").get("compilerPath"),
				options: vscode.workspace.getConfiguration("pawn").get("compileOptions"),
				mainFile: vscode.workspace.getConfiguration("pawn").get("mainFile")
			}
		}
	};

	client = new LanguageClient(
		"pawnServerExample",
		"PAWN Language Server",
		serverOptions,
		clientOptions
	);

	client.start();

	taskProvider = new TaskProvider();
	taskProvider.start();

	console.log("PAWN Language extension activated.");
}

export function deactivate(): Thenable<void> | undefined {

	if (taskProvider) {
		taskProvider.dispose();
	}

	if (!client) {
		return undefined;
	}

	return client.stop();
}

function showNeedCompilerPath(): void {
	vscode.window.showErrorMessage("You have not valid PAWN compiler path.\n\
		Please configure compiler path.\n** DO NOT include compiler name, Just path. **\n\nCompiler name must be \"pawncc.exe\" in compiler path");
}

function isValidCompilerPath(): boolean {
	let compilerPath: string = (vscode.workspace.getConfiguration("pawn").get("compilerPath") as string);

	return (compilerPath.length > 0 && fs.existsSync(path.join(compilerPath, "pawncc.exe")));
}
