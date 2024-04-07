import { Environment } from '../environment/environment';
import { getWorkspaceStructure, buildSmartWorkspaceStructure, getWorkspaceWithEstimations, fmtTree, simplifyTree } from './filesystem_context';
import { ToolCall, ToolCallsGroup } from '../toolbox/toolbox';
import { hashString, trimString } from '../utils';

const xmljs = require('xml-js');
export function formatObject(obj: any, format: "json" | "xml" = "xml"): string {
    if (format === "json") {
        return JSON.stringify(obj, null, 2);
    } else {
        return xmljs.js2xml(obj, { compact: true, spaces: 2 });
    }
}


export interface Message {
    type: "thoughts" | "user" | "system";
    content: string;
    author?: string;
}

export class ContextManagerBase {
    history: (ToolCallsGroup | Message)[];
    objective: string;
    lastFileSystemHash: string;
    lastWorkspaceSummary: string;
    lastLinterOutput: string;
    staticSummary: boolean = true;

    constructor(objective: string = "") {
        this.history = [];
        this.objective = objective;
        this.lastFileSystemHash = "";
        this.lastWorkspaceSummary = "";
        this.lastLinterOutput = "";
    }

    async getLinterOutput(env: Environment): Promise<string> {
        let output = await env.getLinterOutput();
        this.lastLinterOutput = output;
        return output;
    }

    async getWorkspaceStructure(env: Environment): Promise<string> {
        // const workspace = getWorkspaceStructure(await env.getFileSystem(), 30000);
        // let fs_str = formatObject(workspace);
        let fs_str = fmtTree((await simplifyTree(await env.getFileSystem(), 80000, async (cmd) => await env.runCommand(cmd))) as any);
        fs_str += '$ tree -L 3 .\n' + await env.runCommand('tree -L 3 .') + '\n';
        let term_state = await env.getTerminalState();
        let term_str = '';
        if (term_state.length > 0 && term_state[0].history.length > 0) {
            term_str = '**Terminal state:**\n';
            term_state.forEach((tab, index) => {
                term_str += `Tab ${index}:\n${tab.history.join('\n')}\n`;
            });
        }
        let linter_output = this.lastLinterOutput;
        if (!linter_output) {
            linter_output = await this.getLinterOutput(env);
        }
        return `${fs_str}\n${term_str}\nLinter output:\n${linter_output}`;
    }

    async getWorkspaceStructureSummary(env: Environment): Promise<string> {
        if (this.lastWorkspaceSummary && this.staticSummary) {
            return this.lastWorkspaceSummary;
        }
        const fullStructure = await this.getWorkspaceStructure(env);
        this.lastWorkspaceSummary = fullStructure;
        const hash = hashString(fullStructure);
        if (hash === this.lastFileSystemHash && this.lastWorkspaceSummary) {
            return this.lastWorkspaceSummary;
        }
        this.lastFileSystemHash = hash;
        return fullStructure
    }
}

export class ContextManagerXml extends ContextManagerBase {
    todos: string[];
    memory: string;
    history: (ToolCallsGroup | Message)[];
    objective: string;
    lastFileSystemHash: string;
    lastWorkspaceSummary: string;
    lastLinterOutput: string;
    staticSummary: boolean = true;

    constructor(objective: string = "") {
        super();
        this.todos = [];
        this.memory = "";
        this.history = [];
        this.objective = objective;
        this.lastFileSystemHash = "";
        this.lastWorkspaceSummary = "";
        this.lastLinterOutput = "";
    }

    getFirstTodo(): string | undefined {
        /* Get the first one that isn't marked by "- [x]" and remove "- [ ]" */
        for (const todo of this.todos) {
            if (!todo.startsWith("- [x]")) {
                return todo.replace("- [ ]", "");
            }
        }
    }

    async getLinterOutput(env: Environment): Promise<string> {
        let output = await env.getLinterOutput();
        this.lastLinterOutput = output;
        return output;
    }

    async getContext(env: Environment, is_full: boolean = true): Promise<string> {
        const todos = this.todos.join('\n');
        const memory = this.memory;
        let actionHistory = '<history>\n';
        for (const action of this.history) {
            if ("type" in action) {
                actionHistory += `<${action.type}>${action.content}</${action.type}>\n`;
            } else {
                actionHistory += '<function_calls>\n';
                for (const toolCall of action) {
                    actionHistory += '<invoke>\n' + trimString(formatObject({ tool_name: toolCall.tool_name, parameters: toolCall.parameters }, "xml"), 5000) + '\n</invoke>\n';
                }
                actionHistory += '</function_calls>\n';
                actionHistory += '<function_results>\n';
                for (const toolCall of action) {
                    actionHistory += '<result>\n';
                    actionHistory += '<tool_name>' + toolCall.tool_name + '</tool_name>\n';
                    actionHistory += '<stdout>\n' + trimString(toolCall.result || "", 10000) + '\n</stdout>\n';
                    actionHistory += '</result>\n';
                }
                actionHistory += '</function_results>\n';
            }
        }
        actionHistory += '</history>';
        let workspace = await this.getWorkspaceStructureSummary(env);
        const context = `\nMemory:\n${memory}\nWorkspace:\n${workspace}\n\nThe user's request (the overall objective):\n${this.objective}\nThe plan:\n${todos}\n\n\n${actionHistory}\n\n`;
        return context;
    }
}
