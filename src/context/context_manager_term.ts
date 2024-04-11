import { Environment } from '../environment/environment';
import { PromptManager } from '../prompts/prompts';
import { TermTool, TermToolbox } from '../toolbox/editor';
import { ToolCallsGroup } from '../toolbox/toolbox';
import { removeSuffix, splitN, trimString } from '../utils';
import { ContextManagerBase, MessageBase, formatObject } from './context_management';

interface Message extends MessageBase {
    type: "thoughts" | "user" | "system";
}

export function parseAIResponse(response: string): Event | string {
    // thoughts = until ```
    // tool_call = until the last ```
    if (!response.includes('```')) {
        return 'Invalid response format: no code blocks found';
    }
    let [thoughts, tool_call] = splitN(response, '```', 2);
    tool_call = removeSuffix(tool_call.trim(), '```').trim();
    if (!(tool_call.startsWith('open') && tool_call.includes('END')) && !tool_call.startsWith('edit') && tool_call.trim().split('\n').length > 1) {
        return 'Invalid tool call: only one command is allowed in a response (so it should be a single line)';
    }
    if (tool_call.includes('\nEND\nedit') || tool_call.includes('\nEND\nopen')) {
        return 'Invalid tool call: you can only use one command at a time';
    }
    return { type: "assistant", content: response, thoughts, tool_call };
}

export interface Event {
    type: "system" | "user" | "assistant";
    content: string;
    thoughts?: string;
    tool_call?: string;
    output?: string;
}


export class ContextManagerTerm extends ContextManagerBase {
    history: Event[];
    promptManager: PromptManager;
    done: boolean = false;
    search_done: boolean = false;

    constructor(objective: string = "", promptManager: PromptManager = (new PromptManager()).loadYaml('src/prompts/prompts.yaml')) {
        super(objective);
        this.history = [];
        this.promptManager = promptManager;
    }

    async fmtToolOutput(output: string, env: TermToolbox) {
        let content = this.promptManager.getPrompt('output', { output, workdir: await env.Workdir(), opened_file: env.openedFile || 'none' })
        let event: Event = { type: "user", content, output };
        return event;
    }

    filterTools(tools: TermTool[]) {
        let allowedTools = [];
        // if this is search
        if (!this.search_done) {
            allowedTools = tools.filter(tool => tool.name.includes('search'));
        } else {
            allowedTools = tools.filter(tool => !tool.name.includes('search'));
        }
        return allowedTools;
    }

    async getHistoryPrefix(env: TermToolbox, commandDesc: string): Promise<Event[]> {
        let prefix: Event[] = [];
        if (this.promptManager.prompts['system']) {
            prefix.push({ type: "system", content: this.promptManager.getPrompt('system', { commands: commandDesc, bash: this.search_done, edit: this.search_done, search: !this.search_done }) });
        }
        let workspaceSummary = /*'$ tree -L 3 .\n' +*/ trimString(await env.runCommand('tree -L 3 .'), 100000); // await this.getWorkspaceStructure(env);
        let workdir = await env.Workdir();
        if (this.promptManager.prompts['demo'] && this.search_done) {
            prefix.push({ type: "user", content: this.promptManager.getPrompt('demo', {}) });
        }
        if (!this.search_done && this.promptManager.prompts['search_demo']) {
            prefix.push({ type: "user", content: this.promptManager.getPrompt('search_demo', {}) });
        }
        prefix.push({ type: "user", content: this.promptManager.getPrompt('initial', { commands: commandDesc, workdir, workspace: workspaceSummary, objective: this.objective, bash: this.search_done, edit: this.search_done, search: !this.search_done }) });
        return prefix;
    }
}
