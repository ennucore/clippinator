import { Environment } from '../environment/environment';
import { ToolCallsGroup } from '../toolbox/toolbox';
import { trimString } from '../utils';
import { ContextManagerBase, MessageBase, formatObject } from './context_management';


export class ContextManagerXml extends ContextManagerBase {
    todos: string[];
    memory: string;
    history: (ToolCallsGroup | MessageBase)[];
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
