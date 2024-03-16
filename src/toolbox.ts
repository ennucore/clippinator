import { Environment } from './environment/environment'
import { ContextManager, formatFileContent } from './context_management';

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
            description: 'Run a shell command',
            parameters: {
                command: 'echo "Hello, World!"',
            },
        },
    },
    // The tool to rewrite a file
    {
        function: {
            name: 'rewrite_file',
            description: 'Rewrite a file completely (or write to a new one) - without line numbers',
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
            description: 'Patch a file: Replace lines from old_line_start (indexing from 1) to old_line_end (inclusive, 1-indexing) in a file with new content - new_content is without line numbers. Note that after using patch, the line numbers change for all following lines',
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
            description: 'Set the plan, as Markdown todos',
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
        const res = await env.runCommand(command);
        return `Command ${command} ran in terminal.\n${res}`;
    },
    rewrite_file: async (args: Record<string, any>, env: Environment, ctx: ContextManager) => {
        const { path, content } = args;
        env.writeFile(path, content);
        return `Wrote content to file ${path}`;
    },
    patch_file: async (args: Record<string, any>, env: Environment, ctx: ContextManager) => {
        const { path, new_content } = args;
        const file = (await env.getFileSystem()).getByPath(path);

        let old_line_start = parseInt(args.old_line_start);
        let old_line_end = parseInt(args.old_line_end);
        if (file && file.content) {
            let lines = file.content;
            const patchedLines = [
                ...lines.slice(0, old_line_start - 1),
                new_content,
                ...lines.slice(old_line_end + 1),
            ];
            env.writeFile(path, patchedLines.join('\n'));
            return `Patched file ${path}`;
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
        if (file && file.content) {
            return formatFileContent(file.content, 10000);
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
        console.log(args)
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
    }
};
