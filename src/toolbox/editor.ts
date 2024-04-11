import { Environment, FileSystem, Browser, Terminal, UserInterface, Linter } from "../environment/environment";
import * as fspath from 'path';
import { formatFileContent, removeSuffix, splitN } from "../utils";
import { callLLMFast } from "../llm";
import { ContextManagerBase } from "../context/context_management";
import { clearLineNums } from "./toolbox";
import { ContextManagerTerm } from "../context/context_manager_term";

const NUM_LINES = 100;

export class TermEnvironment extends Environment {
    openedFile?: string;
    fileSummaryCache: { [key: string]: string } = {};
    enable_summaries: boolean = true;

    constructor(fileSystem: FileSystem, browser: Browser, terminal: Terminal, user_interface: UserInterface, linter: Linter) {
        super(fileSystem, browser, terminal, user_interface, linter);
    }

    async runCommand(command: string, tabIndex?: number | "new", timeout?: number, isHardTimeout?: boolean): Promise<string> {
        return super.runCommand(command, tabIndex === undefined ? 0 : tabIndex, timeout, isHardTimeout);
    }

    async Workdir(): Promise<string> {
        return (await this.runCommand(`pwd`)).trim();
        // return (await this.runCommand(`pwd | sed 's,${this.fileSystem.rootPath},,'`)).trim() || `this.fileSystem.rootPath (repo root)`;
    }

    async GetCurrentFileContent(): Promise<string | null> {
        if (!this.openedFile) {
            return null;
        }
        return await this.readFile(this.openedFile!);
    }
}

export class TermToolbox extends TermEnvironment {
    cursorPos: number = 1;
    async getFormatedCurrentFileContent(): Promise<string> {
        if (!this.openedFile) {
            return 'No file opened.';
        }
        let content = await this.GetCurrentFileContent();
        if (content === null) {
            return 'The file does not exist.';
        }
        let lines = content?.split('\n') || [];
        let res = '';
        if (this.cursorPos > lines.length) {
            res += `Warning: Line number ${this.cursorPos} is out of bounds.\n`;
            this.cursorPos = lines.length - (NUM_LINES / 2);
            res += `Setting cursor position to ${this.cursorPos}.\n`;
        }
        if (this.cursorPos < 1) {
            res += `Warning: Line number ${this.cursorPos} is out of bounds. Setting it to 1.\n`;
            this.cursorPos = 1;
        }
        let pre_lines_message = this.cursorPos > 1 ? `(${this.cursorPos - 1} lines before)\n` : '';
        if (this.enable_summaries) {
            pre_lines_message = (await this.getSummary(this.openedFile!)) + '\n' + pre_lines_message;
        }
        res += `[File: ${this.openedFile!} (${lines.length} lines total)]\n` + pre_lines_message + formatFileContent(lines, -1, { start: this.cursorPos - 1, length: NUM_LINES });
        res += this.cursorPos + NUM_LINES < lines.length ? `\n(${lines.length - this.cursorPos - NUM_LINES} lines after)` : '';
        return res;
    }

    async open(path: string, cursorPos: number = 1): Promise<string> {
        // check if the file by relative path exists
        if (await this.pathExists(path)) {
            this.openedFile = path;
        } else if (await this.pathExists(fspath.join(await this.Workdir(), path))) {
            this.openedFile = fspath.join(await this.Workdir(), path);
        } else {
            return `File not found: ${path}`;
        }
        this.cursorPos = cursorPos;
        return await this.getFormatedCurrentFileContent();
    }

    async getSummary(path: string): Promise<string> {
        if (this.fileSummaryCache[path]) {
            return '';   // this.fileSummaryCache[path];
        }
        let content = (await this.readFile(path)).split('\n');
        let summary = await callLLMFast(`Please, summarize the file ${path}:\n\`\`\`\n${formatFileContent(content, 1000)}\n\`\`\``);
        this.fileSummaryCache[path] = summary;
        return summary;
    }

    async goto(line: number): Promise<string> {
        if (!this.openedFile) {
            return 'No file opened.';
        }
        this.cursorPos = line;
        return await this.getFormatedCurrentFileContent();
    }

    async scroll_up(lines: number): Promise<string> {
        if (!this.openedFile) {
            return 'No file opened.';
        }
        this.cursorPos = Math.max(0, this.cursorPos - lines);
        return await this.getFormatedCurrentFileContent();
    }

    async scroll_down(lines: number): Promise<string> {
        if (!this.openedFile) {
            return 'No file opened.';
        }
        this.cursorPos += lines;
        return await this.getFormatedCurrentFileContent();
    }

    async create(path: string, content: string = ''): Promise<string> {
        path = fspath.join(await this.Workdir(), path);
        if (await this.pathExists(path)) {
            return 'File already exists.';
        }
        await this.writeFile(path, '' || content);
        let postfix = content ? `and wrote ${content.split('\n').length} lines` : '';
        this.openedFile = path;
        return `Created file ${path}${postfix} and opened it.`;
    }

    async edit(start_line: string, end_line: string, replacement_text: string): Promise<string> {
        if (!this.openedFile) {
            return 'No file opened.';
        }
        let content = await this.GetCurrentFileContent();
        if (content === null) {
            return 'The file does not exist.';
        }
        let lines = content.split('\n');
        let start, end;
        try {
            start = parseInt(start_line);
            end = parseInt(end_line);
            if (start < 1 || start > lines.length || end < 1 || end > lines.length) {
                return 'Invalid line numbers. They should be between 1 and the number of lines in the file.';
            }
        } catch (e) {
            return 'Invalid line numbers.';
        }
        replacement_text = clearLineNums(replacement_text);
        let new_lines = replacement_text.split('\n');
        const patchedLines = [
            ...lines.slice(0, start - 1),
            ...new_lines,
            ...lines.slice(end),
        ];
        let { output: output_before } = await this.lintFile(this.openedFile!);
        await this.writeFile(this.openedFile!, patchedLines.join('\n'));
        let oldNeighboringLines = [];
        let neighboringLines = [];
        for (let i = start - 10; i < end + 5 || i < start + new_lines.length + 5; i++) {
            if (i >= 0 && i < patchedLines.length) {
                neighboringLines.push(`${i + 1}|${patchedLines[i]}`);
            }
            if (i >= 0 && i < lines.length) {
                if (i === start - 1) {
                    oldNeighboringLines.push(`---`);
                }
                if (i === end) {
                    oldNeighboringLines.push(`---`);
                }
                oldNeighboringLines.push(`${i + 1}|${lines[i]}`);
            }
        }
        let diff = `Old content:\n${oldNeighboringLines.join('\n')}\nNew content:\n${neighboringLines.join('\n')}`;
        let { output, is_ok } = await this.lintFile(this.openedFile!);
        if (is_ok || output.split('\n').length <= output_before.split('\n').length) {
            let l = '';
            if (!is_ok) {
                l = `\n\nThe linter output is:\n\`\`\`\n${output}\n\`\`\``;
            }
            return `Edited file ${this.openedFile!} from line ${start} to ${end} with new content. ${diff}${l}`;
        } else {
            // revert the changes
            await this.writeFile(this.openedFile!, content);
            return `Your proposed edit would introduce syntax errors. The changes were not applied. Here is how your patch would look like:\nDiff:\n\`\`\`\n${diff}\n\`\`\`\n\nLinter output:\n\`\`\`\n${output}\n\`\`\``;
        }
    }
    getTools(): TermTool[] {
        return [
            this.open,
            this.goto,
            this.scroll_up,
            this.scroll_down,
            this.create,
            this.edit,
        ].map(f => turnIntoTool(f));
    }
}

export function parseBashCall(call: string): { command: string, args: string } {
    call = call.trim();
    let [command, args] = splitN(call, ' ', 2);
    return { command, args };
}

export function parseArgsDefault(args: string, parms: { name: string, type: string, required: boolean, default_value: any }[]): Record<string, any> {
    let res: Record<string, any> = {};
    // Regular expression to match bash arguments, handling quotes
    // Explanation:
    // - (["'])(?:(?=(\\?))\2.)*?\1: Matches anything inside single or double quotes
    // - [^\s]+: Matches any sequence of characters that are not whitespace
    const regex = /(["'])(?:(?=(\\?))\2.)*?\1|[^\s]+/g;

    let arg_list = [];
    let match;

    while ((match = regex.exec(args)) !== null) {
        // Remove the surrounding quotes and unescape any escaped quotes inside
        const arg = match[0].replace(/^"|"$/g, '').replace(/^'|'$/g, '').replace(/\\(["'])/g, '$1');
        arg_list.push(arg);
    }

    for (let i = 0; i < arg_list.length; i++) {
        let arg = arg_list[i];
        let parm = parms[i];
        if (!parm) {
            res['rest'] = arg_list.slice(i).join(' ');
            break;
        }
        res[parm.name] = arg;
    }
    for (let parm of parms) {
        if (!res[parm.name]) {
            if (parm.required) {
                throw new Error(`Missing required argument: ${parm.name}`);
            } else {
                res[parm.name] = parm.default_value;
            }
        }
    }
    // cast to the correct types (numbers)
    for (let parm of parms) {
        if (parm.type === 'number') {
            try {
                res[parm.name] = parseInt(res[parm.name]);
            } catch (e) {
                throw new Error(`Invalid value for argument ${parm.name}: ${res[parm.name]}. It should be a number.`);
            }
        }
    }
    console.log(args, parms, res)
    return res;
}

let customParsers: Record<string, CallableFunction> = {
    edit(args: string): { start_line: number, end_line: number, replacement_text: string } {
        // edit format: edit <start_line>:<end_line>
        // <replacement_text>
        // END
        let [start_line_s, rest] = splitN(args, ':', 2);
        let [end_line_s, replacement_text] = splitN(rest, '\n', 2);
        // parse the numbers
        let start_line, end_line;
        try {

            start_line = parseInt(start_line_s);
            end_line = parseInt(end_line_s);
        } catch (e) {
            throw new Error('Invalid line numbers. The format of the edit command is: ```\nedit <start_line>:<end_line>\n<replacement_text>\nEND\n```');
        }
        console.log(JSON.stringify(replacement_text))
        if (!replacement_text.trim().endsWith('END')) {
            throw new Error('The replacement text should end with the word `END`.');
        }
        replacement_text = removeSuffix(replacement_text.trim(), 'END') || '';
        return { start_line, end_line, replacement_text };
    },
    create(args: string): { path: string, content: string } {
        // create format: create <path>
        // <content>
        // END
        let [path, content] = splitN(args + '\n', '\n', 2);
        console.log('create', args, path, content)
        if (!content.trim()) {
            return { path, content: '' };
        }
        if (!content.trim().endsWith('END')) {
            throw new Error('The content should end with the word `END`.');
        }
        content = content.trim().slice(0, -3);
        return { path, content };
    }
}

export const doclines: Record<string, string> = {
    open: 'Open a file by path. It will become the currect file for editing.',
    goto: 'Move the cursor to a specific line in the current file.',
    scroll_up: `Scroll up in the current file by ${NUM_LINES} lines.`,
    scroll_down: `Scroll down in the current file by ${NUM_LINES} lines.`,
    create: 'Create a new file by path. Optionally, you can provide the content of the new file (it has to end with END).',
    edit: 'Edit the current file. Provide line numbers with start:end (1-indexed, inclusive) and the new content (it has to end with END).',
    search_class: 'Search for a class in the project directory.',
    search_class_in_file: 'Search for a class in a file.',
    search_function: 'Search for a function/method in the project directory.',
    search_function_in_file: 'Search for a function/method in a file.',
    search_function_in_class: 'Search for a function/method in a given class.',
    search_string: 'Search for a string in the project directory.',
}

export const submitTool: TermTool = {
    name: 'submit',
    function: async (args: Record<string, any>, ctx: ContextManagerTerm, env: TermToolbox) => {
        if (!ctx.search_done) {
            ctx.search_done = true;
        } else {
            ctx.done = true;
        }
        console.log('Done');
        return 'Done';
    },
    description: 'Finish the task and submit the result',
    parameters: [],
    parse_args: (args: string) => ({}),
}

export const custom_usage: Record<string, string> = {
    edit: 'edit start_line:end_line\\nreplacement_text\\nEND',
    create: 'create path[\\n<content>\\nEND]',
}

export interface TermTool {
    name: string;
    function: (args: Record<string, any>, ctx: ContextManagerTerm, env: TermToolbox) => Promise<string>;
    description: string;
    parameters: { name: string, type: string, required: boolean, default_value: any }[];
    parse_args: (args: string) => Record<string, any>;
}

export function fmtDescription(tool: TermTool) {
    let usage_string = tool.name + ' ' + tool.parameters.map((param) => {
        return param.required ? `${param.name}` : `[${param.name}]`;
    }).join(' ');
    if (custom_usage[tool.name]) {
        usage_string = custom_usage[tool.name];
    }
    return `**${tool.name}**\n${tool.description}\nUsage: \`${usage_string}\`\n`;
}

const paramMap: Record<string, { name: string, type: string, required: boolean, default_value: any }[]> = {
    "open": [
        { "name": "path", "type": "string", "required": true, "default_value": null },
        { "name": "cursorPos", "type": "number", "required": false, "default_value": 1 }
    ],
    "goto": [
        { "name": "line", "type": "number", "required": true, "default_value": null }
    ],
    "scroll_up": [
        { "name": "lines", "type": "number", "required": true, "default_value": null }
    ],
    "scroll_down": [
        { "name": "lines", "type": "number", "required": true, "default_value": null }
    ],
    "create": [
        { "name": "path", "type": "string", "required": true, "default_value": null },
        { "name": "content", "type": "string", "required": false, "default_value": "" }
    ],
    "edit": [
        { "name": "start_line", "type": "string", "required": true, "default_value": null },
        { "name": "end_line", "type": "string", "required": true, "default_value": null },
        { "name": "replacement_text", "type": "string", "required": true, "default_value": null }
    ],
    "search_class": [
        { "name": "cls", "type": "string", "required": true, "default_value": null },
        { "name": "path", "type": "string", "required": false, "default_value": "." }
    ],
    "search_class_in_file": [
        { "name": "cls", "type": "string", "required": true, "default_value": null },
        { "name": "file", "type": "string", "required": true, "default_value": "." }
    ],
    "search_function": [
        { "name": "func", "type": "string", "required": true, "default_value": null },
        { "name": "path", "type": "string", "required": false, "default_value": "." }
    ],
    "search_function_in_file": [
        { "name": "func", "type": "string", "required": true, "default_value": null },
        { "name": "file", "type": "string", "required": true, "default_value": "." }
    ],
    "search_function_in_class": [
        { "name": "func", "type": "string", "required": true, "default_value": null },
        { "name": "cls", "type": "string", "required": true, "default_value": null }
    ],
    "search_string": [
        { "name": "query", "type": "string", "required": true, "default_value": null },
        { "name": "path", "type": "string", "required": false, "default_value": "." }
    ],
}



// take a function object from the environment and parse its arguments
export function turnIntoTool(func: CallableFunction, params?: { name: string, type: string, required: boolean, default_value: any }[], is_env: boolean = true): TermTool {
    // let params = func.toString().split('(')[1].split(')')[0].split(',').map((param) => {
    //     let [name, type, default_value] = param.split(/(=|: )/).map((x) => x.trim());
    //     console.log(param, name, type, default_value)
    //     let required = !default_value;
    //     default_value = default_value ? JSON.parse(default_value) : null;
    //     return { name, type, required, default_value };
    // });
    // params = params.filter((param) => param.name !== 'ctx' && param.name !== 'this');
    params = params || paramMap[func.name];
    return {
        name: func.name,
        parameters: params,
        function: (args: Record<string, any>, ctx: ContextManagerTerm, env: TermToolbox) => (env as any)[func.name](...{...params.map((param) => args[param.name] || param.default_value || ""), ctx, env: is_env? env : undefined}),
        description: doclines[func.name] || '',
        parse_args: customParsers[func.name] || ((args: string) => parseArgsDefault(args, params)),
    } as TermTool;
}
