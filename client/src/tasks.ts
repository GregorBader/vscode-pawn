/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { promisify } from 'util';

enum TaskType{
	CurrentFile,
	MainFile
}

interface PawnTaskDefinition extends vscode.TaskDefinition {
	name: string,

	taskType: TaskType;
}

class FolderTaskProvider {
	constructor(private _workspaceFolder: vscode.WorkspaceFolder) {
	}

	public get workspaceFolder(): vscode.WorkspaceFolder {
		return this._workspaceFolder;
	}

	public start(): void {
	}

	public dispose(): void {
	}

	public async getTask(): Promise<vscode.Task | undefined> {
		const rootPath = this._workspaceFolder.uri.scheme === 'file' ? this._workspaceFolder.uri.fsPath : undefined;
		if (!rootPath) {
			return undefined;
		}
		try {
			const config = vscode.workspace.getConfiguration('pawn', this._workspaceFolder.uri);
			
			if(!config.get("mainFile")){
				return undefined;
			}
			
			const file = path.join(rootPath, config.get("mainFile"));
			if(!await this.exists(file)){
				return undefined;
			}

			let argList: string[] = [];
			const name = 'Build ' + config.get("mainFile");

			const kind: PawnTaskDefinition = {
				type: 'pawnccbuildscript',
				taskType: TaskType.MainFile,
				name: name
			};

			// const options: vscode.ShellExecutionOptions = { cwd: this.workspaceFolder.uri.fsPath };
			const command = path.join(config.get("compilerPath"), "pawncc.exe");

			argList = argList.concat(config.get("compileOptions"));
			argList.push(file);

			return new vscode.Task(
				kind, 
				this.workspaceFolder,
				name, 
				'pawn', 
				new vscode.ShellExecution(command, argList),
				'$pawncc'
			);
		} catch (error) {
			return undefined;
		}
	}

	private exists(file: string): Promise<boolean> {
		return new Promise<boolean>((resolve, _reject) => {
			fs.exists(file, (value) => {
				resolve(value);
			});
		});
	}
}

export class TaskProvider {

	private taskProvider: vscode.Disposable | undefined;
	private providers: Map<string, FolderTaskProvider> = new Map();

	constructor() {
	}

	public start(): void {
		const folders = vscode.workspace.workspaceFolders;
		if (folders) {
			this.updateWorkspaceFolders(folders, []);
		}
		vscode.workspace.onDidChangeWorkspaceFolders((event) => this.updateWorkspaceFolders(event.added, event.removed));
		vscode.workspace.onDidChangeConfiguration(this.updateConfiguration, this);
	}

	public dispose(): void {
		if (this.taskProvider) {
			this.taskProvider.dispose();
			this.taskProvider = undefined;
		}
		this.providers.clear();
	}

	private updateWorkspaceFolders(added: ReadonlyArray<vscode.WorkspaceFolder>, removed: ReadonlyArray<vscode.WorkspaceFolder>): void {
		for (let remove of removed) {
			const provider = this.providers.get(remove.uri.toString());
			if (provider) {
				provider.dispose();
				this.providers.delete(remove.uri.toString());
			}
		}
		for (let add of added) {
			const provider = new FolderTaskProvider(add);
			this.providers.set(add.uri.toString(), provider);
			provider.start();
		}
		this.updateProvider();
	}

	private updateConfiguration(): void {
		for (let detector of this.providers.values()) {
			detector.dispose();
			this.providers.delete(detector.workspaceFolder.uri.toString());
		}
		const folders = vscode.workspace.workspaceFolders;
		if (folders) {
			for (let folder of folders) {
				if (!this.providers.has(folder.uri.toString())) {
					let provider = new FolderTaskProvider(folder);
					this.providers.set(folder.uri.toString(), provider);
					provider.start();
				}
			}
		}
		this.updateProvider();
	}

	private updateProvider(): void {
		if (!this.taskProvider && this.providers.size > 0) {
			this.taskProvider = vscode.workspace.registerTaskProvider('pawnccbuildscript', {
				provideTasks: () => {
					return this.getTasks();
				},
				resolveTask(_task: vscode.Task): vscode.Task | undefined {
					return undefined;
				}
			});
		}
		else if (this.taskProvider && this.providers.size === 0) {
			this.taskProvider.dispose();
			this.taskProvider = undefined;
		}
	}

	private async getTaskCurrentFile():Promise<vscode.Task | undefined>{
		if(!vscode.window.activeTextEditor){
			return undefined;
		}
		const currentFile = vscode.window.activeTextEditor.document.uri.scheme === 'file' ? vscode.window.activeTextEditor.document.fileName : undefined;
		if (!currentFile) {
			return undefined;
		}
		let argList: string[] = [];
		
		const name = "Build current file";

		const kind: PawnTaskDefinition = {
			type: 'pawnccbuildscript',
			taskType: TaskType.CurrentFile,
			name: name
		};

		const config = vscode.workspace.getConfiguration('pawn');
		const command = path.join(config.get("compilerPath"), "pawncc.exe");

		argList = argList.concat(config.get("compileOptions"));
		argList.push(currentFile);

		return new vscode.Task(
			kind, 
			vscode.workspace.getWorkspaceFolder(vscode.window.activeTextEditor.document.uri),
			// vscode.TaskScope.Global,
			name, 
			'pawn', 
			new vscode.ShellExecution(command, argList),
			'$pawncc'
		);

	}

	private getTasks(): Promise<vscode.Task[]> {
		const promises: Promise<vscode.Task | undefined>[] = [];

		promises.push(this.getTaskCurrentFile());

		for (let provider of this.providers.values()) {
			promises.push(provider.getTask());
		}
		
		let pro = Promise.all(promises).then((values) => {
			let result = values.filter(value => value !== undefined) as vscode.Task[];
			// result.push(this.getTaskCurrentFile());
			return result;
		});

		return pro;
	}
}