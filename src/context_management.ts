import { Environment, FileSystemTree } from './environment/environment';
import { ToolCall } from './toolbox';

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

export function getWorkspaceStructure(fileSystemTree: FileSystemTree, symbolCap: number): WorkspaceNode {
    let currentCap = symbolCap;

    const readDirRecursive = (tree: FileSystemTree, cap: number): WorkspaceNode => {
        if (tree.isDirectory && tree.children) {
            const children: WorkspaceNode[] = [];
            for (const child of tree.children) {
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
    type: "thoughts" | "user";
    content: string;
}

export class ContextManager {
    todos: string[];
    memory: string;
    history: (ToolCall | Message)[];
    focusedTask: string;
    objective: string;

    constructor(objective: string = "") {
        this.todos = [];
        this.memory = "";
        this.history = [];
        this.focusedTask = "";
        this.objective = objective;
    }

    async getContext(env: Environment): Promise<string> {
        const todos = this.todos.join('\n');
        const memory = this.memory;
        let actionHistory = '<history>\n';
        for (const action of this.history) {
            if ("type" in action) {
                actionHistory += `<${action.type}>${action.content}</${action.type}>\n`;
                continue;
            }
            actionHistory += '<invoked>\n' + formatObject(action, "xml") + '\n</invoked>\n';
        }
        actionHistory += '</history>';
        const workspace = formatObject(getWorkspaceStructure(await env.getFileSystem(), 30000));
        const context = `\nMemory:\n${memory}\nWorkspace:\n${workspace}\n\nThe user's request:\n**${this.objective}**\nYour Todos:\n${todos}\n\n\n${actionHistory}\n\nYour thoughts and actions (without a result for now, with <function_calls><invoke>):`;
        return context;
    }
}
