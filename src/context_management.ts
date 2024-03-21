import { Environment, FileSystemTree } from './environment/environment';
import { callLLMFast } from './llm';
import { ToolCall, ToolCallsGroup } from './toolbox';
import { skip_paths, skip_ext } from './utils';
import { hashString, trimString } from './utils';

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
const CAP_REDUCTION_PER_LEVEL = 10; // Symbol cap reduction per recursion level
const MIN_CAP = 500; // Minimum symbol cap

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
        const formattedContent = trimString(formatFileContent(lines, THRESHOLD), symbolCap);
        return formattedContent;
    }
    return '';
}

export function getWorkspaceStructure(fileSystemTree: FileSystemTree, symbolCap: number): WorkspaceNode {
    let currentCap = symbolCap;

    const readDirRecursive = (tree: FileSystemTree, cap: number): WorkspaceNode => {
        if (tree.isDirectory && tree.children) {
            const children: WorkspaceNode[] = [];
            for (const child of tree.children) {
                if (skip_paths.includes(child.path.split('/').pop() || '')) {
                    continue;
                }
                const nextCap = Math.max(cap / CAP_REDUCTION_PER_LEVEL, MIN_CAP);
                const childTree = readDirRecursive(child, nextCap);
                children.push(childTree);
                cap -= childTree.contentLength() || 0;

                // const fileContent = getFileContent(child, cap);
                // children.push(new WorkspaceNode(child.path, fileContent, []));

                cap = Math.max(cap, MIN_CAP);
            }
            return new WorkspaceNode(tree.path, "", children);
        } else {
            if ((!skip_ext.includes(tree.path.split('.').pop() || '')) && symbolCap > MIN_CAP && currentCap > MIN_CAP) {
                const fileContent = getFileContent(tree, cap);
                return new WorkspaceNode(tree.path, fileContent, []);
            }
            return new WorkspaceNode(tree.path, "", []);
        }
    };

    const rootTree = readDirRecursive(fileSystemTree, currentCap);
    return rootTree;
}

export async function buildSmartWorkspaceStructure(fileSystemTree: FileSystemTree, objective: string = ""): Promise<string> {
    if (!fileSystemTree.isDirectory) {
        if (fileSystemTree.content && fileSystemTree.content!.length > 10000) {
            let fileContent = formatFileContent(fileSystemTree.content!, 50000);
            let fileContentSummarized = await callLLMFast(`We are working in a workspace with a lot of files. 
Overall, we are pursuing this objective:
<objective>${objective}</objective>
Here is a file with the path ${fileSystemTree.path} and its content:

${fileContent}

Please, provide the main lines of this file with some comments. Respond only with the lines. Make it in a format similar to the original, with all the important classes and functions included with their description.
If the content is relevant to the objective, make it especially detailed.
For example, write something like this:
40|class MyClass:   # handling the logic for ...
50|    def my_function():   # function to ...
55|class AnotherClass:   # ...

Do not respond with any lines that are not in the format above.
`);
            return fileSystemTree.path + '\n' + fileContentSummarized;
        } else {
            return fileSystemTree.path + '\n' + formatFileContent(fileSystemTree.content || [], 10000);
        }
    } else {
        // now we draw a tree
        let tree = `${fileSystemTree.path}\n`;
        // call this function for all children

        if (!fileSystemTree.children) {
            return tree;
        }
        let childrenContent = [];
        // for (let child of fileSystemTree.children!) {
        //     childrenContent.push(await buildSmartWorkspaceStructure(child, objective));
        // }
        let n = 7;

        // iterate over groups of 4 children and use Promise.allSettled to parallelize the calls
        for (let i = 0; i < fileSystemTree.children.length; i += n) {
            const children = fileSystemTree.children.slice(i, i + n);
            const promises = children.map(child => buildSmartWorkspaceStructure(child, objective));
            const results = await Promise.allSettled(promises);
            for (const result of results) {
                if (result.status === 'fulfilled') {
                    childrenContent.push(result.value);
                }
            }
        }
        for (let childContent of childrenContent) {
            childContent = '├── ' + childContent.replace(/\n/g, '\n│   ');
            tree += childContent;
        }
        if (tree.length > 17000) {
            tree = await callLLMFast(`We are working in a workspace with a lot of files.
Overall, we are pursuing this objective:
<objective>${objective}</objective>
Here is the structure of a folder with the path ${fileSystemTree.path}:

${tree}

Please, provide a smart tree for this folder. Respond only with the tree in the format like above. Each of your line should start with something like '├── ' or '│   ', and then contain either a path or a line in the format 'n|class ClassName:   # description'. Include only the most important files, classes and functions.
For some files, you can skip their content and just write their path. If something is relevant to the objective, include it in more detail.
Do not respond with anything other than the resulting tree. If you say something like "Here is the tree" or "Ok", it will be a great mistake.
Make sure to have correct syntax in the tree.
`);
        }
        return tree;
    }
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
        let linter_output = this.lastLinterOutput;
        if (!linter_output) {
            linter_output = await this.getLinterOutput(env);
        }
        return `${fs_str}\n${term_str}\nLinter output:\n${linter_output}`;
    }

    async getWorkspaceStructureSummary(env: Environment): Promise<string> {
        const fullStructure = await this.getWorkspaceStructure(env);
        const hash = hashString(fullStructure);
        if (hash === this.lastFileSystemHash && this.lastWorkspaceSummary) {
            return this.lastWorkspaceSummary;
        }
        this.lastFileSystemHash = hash;
        //         this.lastWorkspaceSummary = await callLLMFast(`We are working in a workspace with some files and terminals. We have the following objective:
        // <objective>${this.objective}</objective>
        // Please, provide a summary of the following workspace structure. 
        // It should be in a very similar format to the one you see below, but with a lot less details. 
        // It should contain all the files and directories and an outline of the meaning of each file, the main classes and functions etc it contains (same with the terminal tabs if they are there). Reply ONLY with the summary, in a similar format to the original structure. 
        // In the summary, you have to includ **all** the paths exactly the same as in the original, and the content should be in the same form as the original content although you can omit some lines. However, do include all the important lines with important classes and functions etc. in the format \`n|class ClassName:\' with some descriptions. If some file is tangentially related to the overall objective, include its content **fully**.
        // Here is the workspace:\n\`\`\`\n${fullStructure}\n\`\`\`
        // Now, based on that, provide your edit. IT HAS TO BE ALMOST THE SAME LENGTH AS THE ORIGINAL, SAME FORMAT, AND VERY SIMILAR IN MANY WAYS. INCLUDE IMPORTANT OR RELEVANT LINES FROM EACH FILE
        // `);
        this.lastWorkspaceSummary = await buildSmartWorkspaceStructure(await env.getFileSystem(), this.objective);
        console.log("\n\n\nWorkspace Summary:\n", this.lastWorkspaceSummary)
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
