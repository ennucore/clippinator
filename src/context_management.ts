import { Environment, FileSystemTree } from './environment/environment';
import { callLLMFast } from './llm';
import { ToolCall, ToolCallsGroup} from './toolbox';
import { hashString } from './utils';

export function formatFileContent(lines: string[], line_threshold: number = 2000): string {
    let formattedLines;
    if (lines.length > line_threshold) {
      const startLines = lines.slice(0, line_threshold / 2);
      const endLines = lines.slice(-line_threshold / 2);
      formattedLines = [...startLines, '...', ...endLines];
    } else {
      formattedLines = lines;
    }

    const formattedContent = formattedLines.map((line, index) => `${index + 1}|${line}`).join('\n');
    return formattedContent;
}


const xmljs = require('xml-js');
export function formatObject(obj: any, format: "json" | "xml" = "xml"): string {
    if (format === "json") {
        return JSON.stringify(obj, null, 2);
    } else {
        return xmljs.js2xml(obj, { compact: true, spaces: 2 });
    }
}


const THRESHOLD = 300; // Define a threshold for the number of lines
const CAP_REDUCTION_PER_LEVEL = 2500; // Symbol cap reduction per recursion level
const MIN_CAP = 1000; // Minimum symbol cap

export class WorkspaceNode {
    path: string;
    content: string;
    children?: WorkspaceNode[];

    constructor(path: string, content: string, children?: WorkspaceNode[]) {
        this.path = path;
        this.content = content;
        this.children = children;
    }

    contentLength(): number {
        if (this.content && !this.children) {
            return this.content.length;
        }
        if (this.children) {
            return this.children.reduce((acc, child) => acc + child.contentLength(), 0);
        }
        return 0;
    }
}

function getFileContent(fileSystemTree: FileSystemTree, symbolCap: number): string {
    if (!fileSystemTree.isDirectory && fileSystemTree.content) {
        const fileContent = fileSystemTree.content.join('\n').slice(0, symbolCap);
        const lines = fileContent.split(/\r?\n/);
        const formattedContent = formatFileContent(lines, THRESHOLD);
        return formattedContent;
    }
    return '';
}

const skip_ext = ['lock', 'png']
const skip_paths = ['node_modules', '.git', '.trunk']

export function getWorkspaceStructure(fileSystemTree: FileSystemTree, symbolCap: number): WorkspaceNode {
    let currentCap = symbolCap;

    const readDirRecursive = (tree: FileSystemTree, cap: number): WorkspaceNode => {
        if (tree.isDirectory && tree.children) {
            const children: WorkspaceNode[] = [];
            for (const child of tree.children) {
                if (skip_paths.includes(child.path.split('/').pop() || '')) {
                    continue;
                }
                const nextCap = Math.max(cap - CAP_REDUCTION_PER_LEVEL, MIN_CAP);
                const childTree = readDirRecursive(child, nextCap);
                children.push(childTree);
                // currentCap -= childTree.contentLength() || 0;
                // if (currentCap <= 0) break;
            }
            return new WorkspaceNode(tree.path, "", children);
        } else {
            if (!skip_ext.includes(tree.path.split('.').pop() || '')) {
                const fileContent = getFileContent(tree, cap);
                return new WorkspaceNode(tree.path, fileContent, []);
            }
            return new WorkspaceNode(tree.path, "", []);
        }
    };

    const rootTree = readDirRecursive(fileSystemTree, currentCap);
    return rootTree;
}

export interface Message {
    type: "thoughts" | "user" | "system";
    content: string;
}

export class ContextManager {
    todos: string[];
    memory: string;
    history: (ToolCallsGroup | Message)[];
    objective: string;
    lastFileSystemHash: string;
    lastWorkspaceSummary: string;
    lastLinterOutput: string;

    constructor(objective: string = "") {
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

    async getWorkspaceStructure(env: Environment): Promise<string> {
        const workspace = getWorkspaceStructure(await env.getFileSystem(), 30000);
        let fs_str = formatObject(workspace);
        let term_state = await env.getTerminalState();
        let term_str = '';
        if (term_state.length > 0 && term_state[0].history.length > 0) {
            term_str = '**Terminal state:**\n';
            term_state.forEach((tab, index) => {
                term_str += `Tab ${index}:\n${tab.history.join('\n')}\n`;
            });            
        }
        return `${fs_str}\n${term_str}`;
    }

    async getWorkspaceStructureSummary(env: Environment): Promise<string> {
        const fullStructure = await this.getWorkspaceStructure(env);
        const hash = hashString(fullStructure);
        if (hash === this.lastFileSystemHash && this.lastWorkspaceSummary) {
            return this.lastWorkspaceSummary;
        }
        this.lastFileSystemHash = hash;
        this.lastWorkspaceSummary = await callLLMFast(`Please, provide a summary of the following workspace structure. 
It should be in a very similar format to the one you see below, but with a lot less details. It should contain all the files and directories and an outline of the meaning of each file, the main classes and functions etc it contains (same with the terminal tabs if they are there). Reply ONLY with the summary, in a similar format to the original structure. Here is the workspace structure:\n\`\`\`\n${fullStructure}\n\`\`\``);
        return this.lastWorkspaceSummary;
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
                    actionHistory += '<invoke>\n' + formatObject({tool_name: toolCall.tool_name, parameters: toolCall.parameters}, "xml") + '\n</invoke>\n';
                }
                actionHistory += '</function_calls>\n';
                actionHistory += '<function_results>\n';
                for (const toolCall of action) {
                    actionHistory += '<result>\n';
                    actionHistory += '<tool_name>' + toolCall.tool_name + '</tool_name>\n';
                    actionHistory += '<stdout>\n' + toolCall.result + '\n</stdout>\n';
                    actionHistory += '</result>\n';
                }
                actionHistory += '</function_results>\n';
            }
        }
        actionHistory += '</history>';
        let workspace = formatObject(getWorkspaceStructure(await env.getFileSystem(), 30000));
        if (!is_full) {
            workspace = await this.getWorkspaceStructureSummary(env);
        }
        const context = `\nMemory:\n${memory}\nWorkspace:\n${workspace}\n\nThe user's request (the overall objective):\n${this.objective}\nThe plan:\n${todos}\n\n\n${actionHistory}\n\n`;
        return context;
    }
}
