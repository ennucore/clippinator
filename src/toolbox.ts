import { Environment } from './environment/environment'
import { ContextManager } from './context/context_management';
import { formatFileContent } from './utils';

export interface Tool {
    function: {
        name: string;
        description?: string;
        parameters?: Record<string, any>;
    };
}

export interface ToolCall {
    tool_name: string;
    parameters: Record<string, any>;
    result?: string;
}

export type ToolCallsGroup = ToolCall[];

export let tools: Tool[] = [
    // The tool to run a shell command
    {
        function: {
            name: 'run_shell_command',
            description: 'Run a shell command (use a tab if you want to continue working in the terminal later and you need the history; by default, use \'-1\' to run it in-place)',
            parameters: {
                command: 'echo "Hello, World!"',
                tab: "-1"
            },
        },
    },
    // The tool to rewrite a file
    {
        function: {
            name: 'rewrite_file',
            description: 'Rewrite a file completely (or write to a new one) - provide full content of the entire file without line numbers',
            parameters: {
                path: 'src/hello.txt',
                content: 'Hello, World!',
            },
        },
    },
    // The tool to replace lines in a file
    {
        function: {
            name: 'patch_file',
            description: 'Patch a file: Replace lines from old_line_start (indexing from 1) to old_line_end (non-inclusive, 1-indexing) in a file with new content - new_content is without line numbers. Note that after using patch, the line numbers change for all following lines; 15:15 inserts the content, 15:16 replaces a line with the content',
            parameters: {
                path: 'hello.txt',
                old_line_start: 10,
                old_line_end: 20,
                new_content: 'Goodbye, World!\nThis will be the eleventh lint',
            },
        },
    },
    // Read a file
    {
        function: {
            name: 'read_file',
            description: 'Read a file',
            parameters: {
                path: 'hello.txt',
            },
        },
    },
    // Show a pop-up message to the user
    {
        function: {
            name: 'show_message',
            description: 'Show a pop-up message to the user',
            parameters: {
                message: 'Hello, World!',
            },
        },
    },
    {
        function: {
            name: 'ask_user',
            description: 'Ask the user for input',
            parameters: {
                prompt: 'What is your name?',
            },
        }
    },
    {
        function: {
            name: 'set_todos',
            description: 'Set the plan, as Markdown todos. x marks a completed todo (it will not get). Each line should be a todo starting with "- [ ]" or "- [x]" (no subtasks), and each todo is only one line',
            parameters: {
                todos: '- [x] Todo 1\n- [ ] Todo 2\n- [ ] Todo 3',
            },
        }
    },
    {
        function: {
            name: 'remember',
            description: 'Remember some important factoid - add it to the memory',
            parameters: {
                factoid: 'The mitochondria is the powerhouse of the cell',
            },
        }
    },
    {
        function: {
            name: 'set_memory',
            description: 'Set the memory',
            parameters: {
                memory: 'The mitochondria is the powerhouse of the cell\nThe sky is blue',
            },
        }
    },
    {
        function: {
            name: 'linter',
            description: 'Run the linter on the code',
            parameters: {},
        }
    }
    // {
    //     function: {
    //         name: 'set_focused_task',
    //         description: 'Set the focused task',
    //         parameters: {
    //             task: 'Move the class ... from file ... to ...',
    //         },
    //     }
    // }
];

export let all_possible_parameter_names: string[] = /* extract from tools */ tools.flatMap(tool => Object.keys(tool.function.parameters || {}));

export const clearLineNums: (content: string) => string = (content: string) => {
    if (content.split('\n').length > 3 && content.split('\n').every((line: any, index: any) => line.startsWith(`${index + 1}|`))) {
        content = content.split('\n').map((line: any, index: any) => line.split('|').slice(1).join('|')).join('\n');
    }
    return content;
};

export function final_result_tool(description: string, params: Record<string, any>): Tool {
    return {
        function: {
            name: 'final_result',
            description: description,
            parameters: params,
        }
    };
}

export let tool_functions: Record<string, (args: Record<string, any>, env: Environment, ctx: ContextManager) => Promise<string>> = {
    run_shell_command: async (args: Record<string, any>, env: Environment, ctx: ContextManager) => {
        const { command } = args;
        let tab;
        if (args.tab === "-1") {
            tab = undefined;
        } else if (args.tag === "new") {
            tab = "new" as "new";
        } else {
            tab = parseInt(args.tab);
        }
        const res = await env.runCommand(command, tab);
        return `Command ${command} ran in terminal.\n\`\`\`\n${res}\n\`\`\``;
    },
    rewrite_file: async (args: Record<string, any>, env: Environment, ctx: ContextManager) => {
        let { path, content } = args;
        // if there are more 3 lines and each line starts with "number|", then we remove the line numbers from the beginnings of lines
        content = clearLineNums(content);
        env.writeFile(path, content);
        return `Wrote content to file ${path}`;
    },
    patch_file: async (args: Record<string, any>, env: Environment, ctx: ContextManager) => {
        let { path } = args;
        let new_content = /* lines */ args.new_content.split('\n');
        const file = (await env.getFileSystem()).getByPath(path);

        let old_line_start = parseInt(args.old_line_start);
        let old_line_end = parseInt(args.old_line_end);
        if (file ) {
            let lines = file.content || [];
            const patchedLines = [
                ...lines.slice(0, old_line_start - 1),
                ...new_content,
                ...lines.slice(old_line_end - 1),
            ];
            env.writeFile(path, patchedLines.join('\n'));
            let oldNeighboringLines = [];
            let neighboringLines = [];
            for (let i = old_line_start - 10; i < old_line_end + 5 || i < old_line_start + new_content.length + 5; i++) {
                if (i >= 0 && i < patchedLines.length) {
                    neighboringLines.push(`${i + 1}|${patchedLines[i]}`);
                }
                if (i >= 0 && i < lines.length) {
                    if (i === old_line_start - 1) {
                        oldNeighboringLines.push(`---`);
                    }
                    if (i === old_line_end - 1) {
                        oldNeighboringLines.push(`---`);
                    }
                    oldNeighboringLines.push(`${i + 1}|${lines[i]}`);
                }
            }
            return `Patched file ${path} from line ${old_line_start} to ${old_line_end} with new content. Here is what was in the file:\n${oldNeighboringLines.join('\n')}\nThe new content in the neighborhood:\n${neighboringLines.join('\n')}\nRemember that the line numbers below these have changed, and check that what we got (see above) is what you wanted`;
        } else {
            return `File ${path} not found`;
        }
    },
    show_message: async (args: Record<string, any>, env: Environment, ctx: ContextManager) => {
        const { message } = args;
        env.showMessage(message);
        return `Showed message: ${message}`;
    },
    read_file: async (args: Record<string, any>, env: Environment, ctx: ContextManager) => {
        const { path } = args;
        const file = (await env.getFileSystem()).getByPath(path);
        if (file) {
            let content = file.content || [];
            return formatFileContent(content, 10000);
        } else {
            return `File ${path} not found`;
        }
    },
    ask_user: async (args: Record<string, any>, env: Environment, ctx: ContextManager) => {
        const { prompt } = args;
        const response = await env.askPrompt(prompt);
        return response;
    },
    set_todos: async (args: Record<string, any>, env: Environment, ctx: ContextManager) => {
        const { todos } = args;
        ctx.todos = todos.split('\n');
        return `The todos are updated.`;
    },
    remember: async (args: Record<string, any>, env: Environment, ctx: ContextManager) => {
        const { factoid } = args;
        ctx.memory += '\n' + factoid;
        return `Remembered`;
    },
    set_memory: async (args: Record<string, any>, env: Environment, ctx: ContextManager) => {
        const { memory } = args;
        ctx.memory = memory;
        return `Updated the memory.`;
    },
    final_result: async (args: Record<string, any>, env: Environment, ctx: ContextManager) => {
        return `Done`;
    },
    linter: async (args: Record<string, any>, env: Environment, ctx: ContextManager) => {
        const output = await ctx.getLinterOutput(env);
        return output;
    }
};
