import { Environment } from '../environment/environment';
import { getWorkspaceStructure, buildSmartWorkspaceStructure, getWorkspaceWithEstimations, fmtTree, simplifyTree } from './filesystem_context';
import { ToolCall, ToolCallsGroup } from '../toolbox/toolbox';
import { hashString } from '../utils';

const xmljs = require('xml-js');
export function formatObject(obj: any, format: "json" | "xml" = "xml"): string {
    if (format === "json") {
        return JSON.stringify(obj, null, 2);
    } else {
        return xmljs.js2xml(obj, { compact: true, spaces: 2 });
    }
}


export interface MessageBase {
    type: "thoughts" | "user" | "system";
    content: string;
    author?: string;
}

export class ContextManagerBase {
    objective: string;
    lastFileSystemHash: string;
    lastWorkspaceSummary: string;
    lastLinterOutput: string;
    staticSummary: boolean = true;

    constructor(objective: string = "") {
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
        fs_str += /*'$ tree -L 3 .\n' +*/ await env.runCommand('tree -L 3 .') + '\n';
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


