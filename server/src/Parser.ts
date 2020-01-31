import * as fs from "fs";
import * as path from "path";
import { spawn } from "child_process";
import { Grammar } from "./Grammar";
import { ErrorManager, PawnError } from "./ErrorManager";
import { ParserManager } from "./ParserManager";
import { getConnection, isHaveConfigurationCapability, globalSettings } from "./server";
import { Connection } from 'vscode-languageserver';

interface ParserResult {
	type: string;
	contents: any;
}

export class Parser
{
	private mainPath: string;
	private mainFile: string = "";
	grammar: Grammar;
	errorManager: ErrorManager;
	private stdoutBuffer: string;
	private parserProgressCount: number;
	private parserResolve: any[];
	private iAmWorkspaceParser: boolean;

	constructor(mainPath: string, isWorkspaceParser: boolean = false) {
		this.mainPath = mainPath;
		this.grammar = new Grammar();
		this.errorManager = new ErrorManager();
		this.stdoutBuffer = " ";
		this.parserProgressCount = 0;
		this.parserResolve = [];
		this.iAmWorkspaceParser = isWorkspaceParser;
	}

	async run(): Promise<void> {
		const connection: Connection = getConnection();

		if (!isHaveConfigurationCapability() || this.isInProgress()) {
			return;
		}

		if (this.iAmWorkspaceParser && (this.mainFile === undefined || !this.mainFile.length)) {
			return;
		}

		let args: string[] = [ (this.iAmWorkspaceParser) ? path.join(this.mainPath, this.mainFile) : this.mainPath ];
		const pawnConfig = globalSettings.compiler;

		args = args.concat(pawnConfig.options);
		args.push("-R");

		/*if (this.iAmWorkspaceParser) {
			args.push("-i" + this.mainPath + path.sep);
		}*/

		++this.parserProgressCount;

		const parser = spawn(path.join(globalSettings.compiler.path, "pawncc.exe"), args, { cwd: path.dirname(this.mainPath) });

		parser.on("error", (err: Error) => {
			if (--this.parserProgressCount < 0) {
				this.parserProgressCount = 0;
			}

			connection.console.log("Parser spawn ERROR!");
			connection.console.log(err.message);
		});

		parser.stderr.on("data", (chunk: string | Buffer) => {
			connection.console.log(chunk.toString());
		});

		parser.stdout.on("data", (chunk: string | Buffer) => {
			let data: string = chunk.toString().replace(/[\r]/g, '');
			
			this.stdoutBuffer += data;
		});

		parser.on("exit", () => {
			let splitedData: string[] = this.stdoutBuffer.split('\n');

			this.errorManager.clear();

			splitedData.forEach((value: string) => {
				if (value.length > 0) {
					let result: ParserResult | undefined = undefined;

					try {
						result = JSON.parse(value.replace(/\bInfinity\b/g, "0.0"));
					} catch (e) {
						connection.console.log("Parsing data ERROR!");
						connection.console.log(e.message);
					}

					if (result !== undefined) {
						if (result.type == "error") {
							this.errorManager.addError(result.contents);
						} else if (result.type == "files") {
							this.grammar.addFiles(result.contents);
						} else if (result.type == "constants") {
							this.grammar.addConstantExpressions(result.contents);
						} else if (result.type == "tags") {
							this.grammar.addTags(result.contents);
						} else if (result.type == "enumerators") {
							this.grammar.addEnumerators(result.contents);
						} else if (result.type == "variables") {
							this.grammar.addVariables(result.contents);
						} else if (result.type == "functions") {
							this.grammar.addFunctions(result.contents);
						} else if (result.type == "substitutes") {
							this.grammar.addSubstitutes(result.contents);
						}
					}
				}
			});
			/*this.grammar.functions.forEach((value) => {
				connection.console.log(value.detail);
			});*/

			this.grammar.makeDetailAll();

			connection.console.log("");
			this.errorManager.errors.forEach((error: PawnError) => {
				connection.console.log(error.error_detail);
			});

			this.stdoutBuffer = "";

			if (--this.parserProgressCount < 0) {
				this.parserProgressCount = 0;
			}

			connection.console.log("Path \"" + this.mainPath + "\" Parsing end.");

			/* resolve all waiting promises */
			while(this.parserResolve.length > 0) {
				const resolve = this.parserResolve.shift();
				if (resolve) {
					resolve();
				}
			}

			if (this.isWorkspaceParser()) {
				ParserManager.updateGarbageCollect(this);
			}
		});
	}

    /**
     * Wait for parser result if it is currently in progress.
     */
	async waitForResult(): Promise<void> {
		return new Promise((resolve, reject) => {
			if(this.isInProgress()) {
				this.parserResolve.push(resolve);
			}
			else
				resolve();
		});
	}

	setMainFile(file: string, reparse: boolean = true): void {
		if (!this.iAmWorkspaceParser) {
			return;
		}

		this.mainFile = file;

		if (reparse) {
			this.grammar.clear();
			this.run();
		}
	}

	getPath(): string {
		return this.mainPath;
	}

	getMainFile(): string | undefined {
		return this.mainFile;
	}

	isInProgress(): boolean {
		return (this.parserProgressCount > 0);
	}

	isWorkspaceParser(): boolean {
		return this.iAmWorkspaceParser;
	}
}
