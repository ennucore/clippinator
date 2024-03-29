import { ContextManager, Message } from "./context/context_management";
import { Environment, CLIUserInterface, DummyBrowser, DummyTerminal, TrunkLinter } from "./environment/environment";
import { SimpleTerminal } from './environment/terminal';
import { DefaultFileSystem } from "./environment/filesystem";
import { Tool, ToolCall, clearLineNums, final_result_tool, tool_functions, tools } from "./toolbox";
import { callLLM, callLLMFast, callLLMTools, haiku_model, opus_model, sonnet_model } from "./llm";
import { haiku_simple_additional_prompt, planning_examples, task_prompts } from "./prompts";
import { trimString } from "./utils";
var clc = require("cli-color");

let preprompt = `You are Clippinator, an AI software engineer. You operate in the environment where you have access to tools. You can use these tools to execute the user's request.
When you are done executing everything in the plan, write "<DONE/>" as a separate line.
Try to execute the actions you need to take in one step (one invoke) if you don't need the output of the previous ones.
Before calling the tools, write your thoughts out loud and describe why you are doing that and what you expect to happen.
`;


// `When you get the request, make a plan and save it into todos. 
// Try to make the plan as simple as possible, with a few steps (one step can be "refactor ... to be ..." or something on that level). Before declaring the plan, think about what you have to do. Don't make the plan too specific, the steps should be more like milestones. Each step will correspond to multiple tool calls. 
// For example, moving something from one file to another can be one task.
// After making the plan, execute the plan by focusing on one task at a time, adjusting it if something goes wrong.
// `

export class Clipinator {
    env: Environment;
    contextManager: ContextManager;

    constructor(objective: string = "", path: string = ".") {
        this.contextManager = new ContextManager(objective);
        this.env = new Environment(new DefaultFileSystem(path), new DummyBrowser(), new SimpleTerminal(path), new CLIUserInterface(), new TrunkLinter(path));
    }

    async runTool(tool: Tool, parameters: Record<string, any>): Promise<string> {
        const toolFunction = tool_functions[tool.function.name];
        const result = await toolFunction(parameters, this.env, this.contextManager);
        return result;
    }

    async runToolCall(toolName: string, toolArguments: Record<string, any>): Promise<string> {
        let toolCall = { tool_name: toolName, parameters: toolArguments } as ToolCall;
        const tool = tools.find((t) => t.function.name === toolCall.tool_name);
        if (!tool) {
            return `Tool ${toolCall.tool_name} not found`;
        }
        const result = await this.runTool(tool, toolCall.parameters);
        return result;
    }

    async getPrompt(task: string = "", additional_context?: string): Promise<string> {
        let is_full = additional_context !== undefined ? false : true;
        let res = await this.contextManager.getContext(this.env, is_full) + '\n';
        if (additional_context) {
            res += additional_context + '\n' + task;
        } else {
            res += task;
        }
        return res;
    }

    async oneStep(task: string = "", result_format?: Record<string, any>, result_description?: string, additional_context?: string, disableTools: boolean | string[] = false, model: string = opus_model) {
        const prompt = await this.getPrompt(task, additional_context);
        let tools_now = tools;
        if (disableTools === true) {
            tools_now = [];
        }
        if (Array.isArray(disableTools)) {
            tools_now = tools_now.filter((tool) => !disableTools.includes(tool.function.name));
        }
        if (result_format) {
            tools_now = tools_now.concat([final_result_tool(result_description || '', result_format)]);
        }
        const { toolCallsFull, response } = await callLLMTools(prompt, tools_now, this.runToolCall.bind(this), undefined, preprompt, model);
        this.contextManager.history.push({ type: "thoughts", content: response });
        this.contextManager.history.push(toolCallsFull);
        let result = null;
        /* parse result if final_result() was called */
        if (result_format) {
            let result_call = toolCallsFull.filter((toolCall) => toolCall.tool_name === "final_result")[0];
            if (result_call) {
                result = result_call.parameters;
            }
        }
        return { response, toolCallsFull, result };
    }

    async run(task: string = "", result_format?: Record<string, any>, result_description?: string, additional_context?: string, stop_at_tool?: string, disableTools: boolean | string[] = false, model: string = opus_model, max_iterations: number = 100) {
        while (max_iterations-- > 0) {
            let { response, result, toolCallsFull } = await this.oneStep(task, result_format, result_description, additional_context, disableTools, model);
            if (result) {
                return result;
            }
            if (response.includes("<DONE/>")) {
                console.log(response)
                // console.log(await this.getPrompt())
                break;
            }
            if (stop_at_tool) {
                let stop_tool_index = toolCallsFull.findIndex((toolCall) => toolCall.tool_name === stop_at_tool);
                if (stop_tool_index !== -1) {
                    // console.log(await this.getPrompt())
                    break;
                }
            }
        }
    }

    async generatePlan() {
        await this.run(
            `
Current linter output:
\`\`\`
${await this.contextManager.getLinterOutput(this.env)}
\`\`\`
Please, generate a plan to achieve the following objective: "${this.contextManager.objective}".
Don't make the todos too small. "Refactor ... to be ..." is a good level of granularity.
First, think about how to achieve it using the tools available, then write down the plan using the set_todos() tool. After that, write '<DONE/>'

${planning_examples}`,
            undefined,
            undefined,
            "",
            "set_todos"
        );
    }

    async executeATask() {
        let currentTask = this.contextManager.getFirstTodo()!;
        let { result } = await this.oneStep(
            `Please, take the workspace structure above and this task: "${currentTask}" and provide a plan for achieving the task, the summary of the aspects of workspace structure relevant to the task, and the list of relevant files.
Also, select advice out of the list below that might be relevant. You can select a lot; if the task will envolve patching, repeat everything from the patching section, including the examples; include all the general advice. If the files involved are small, tell the agent not to patch and to write instead. Here is the entire advice (it's fine to copy it entirely):
\`\`\`
${task_prompts}
\`\`\`
`,
            { plan: "", relevantSummary: "", pathList: "folder1/file1.txt\nanotherfile.py", relevantAdvice: "" },
            "Declare the task parameters",
            "",
            ["set_todos"],
            "random_sonnet_opus"
            // sonnet_model
        );
        let additionalContext = "";
        if (result) {
            // The course of actions for the task:\n${result.plan}\n
            additionalContext = `Some relevant facts: ${result.relevantSummary}\nSome advice that might be relevant:\n${result.relevantAdvice}\nThe list of relevant files is: ${result.pathList}`;
            console.log(clc.blue.bold("Additional context for the task:\n") + clc.green(additionalContext) + '\n');
            // now, the files themselves
            let files = result.pathList.split("\n");
            for (let file of files) {
                let fileContent = (await this.env.getFileSystem()).getByPath(file)?.content;
                additionalContext += `\n<path>${file}</path>\n<content>${fileContent}</content>`;
            }
            additionalContext += '\n';
        }
        this.contextManager.history.push({ type: "system", content: `Executing the task: "${currentTask}"` } as Message);
        await this.run(
            `Please, execute the following task: "${currentTask}". After everything is finished, write <DONE/>.`,
            undefined,
            undefined,
            additionalContext,
            undefined,
            ["set_todos"],
            sonnet_model
        );
    }

    async reflection() {
        let currentTask = this.contextManager.getFirstTodo()!;
        await this.run(
            `Above, some actions were taken to achieve the task: "${currentTask}". Please, reflect on the actions taken and the results achieved. 
If everything is well, use set_todos() to update the plan marking this task as done. If some new information was discovered, you can edit the next steps of the plan.
If the task wasn't achieved, update the plan in order to achieve the objective successfully: re-attempting this task with the new information, or trying another way.
If some damage was done while trying to complete the task, add a task specifying how to fix it.
Look at the linter output below, look at the workspace structure above to check that everything is ok (not just the history). If the agent was supposed to write to a file, check that the file contents are correct and that the task was completed.
If there are linter errors, add a task to fix them.

In the new plan, don't make the todos too small. "Refactor ... to be ..." is a good level of granularity.
It's fine if the new plan is the same as the old one, but with the current task marked as done.
It's also fine if the new plan only has one or two todos. If the objective is complete, set_todos() with all the todos marked as done.
Start by writing your analysis of the situation, then write the new plan using the set_todos() tool. After that, write '<DONE/>'

Previous linter output:
\`\`\`
${this.contextManager.lastLinterOutput}
\`\`\`
Linter output:
\`\`\`
${await this.contextManager.getLinterOutput(this.env)}
\`\`\`
`,
            undefined,
            undefined,
            undefined,
            "set_todos",
            undefined,
            // sonnet_model
        );
        console.log("Linter output:\n\n", this.contextManager.lastLinterOutput);
    }

    async fullCycle() {
        await this.generatePlan();
        console.log(clc.blue.bold("Plan generated:\n") + clc.green(this.contextManager.todos.join('\n')) + '\n');
        while (this.contextManager.getFirstTodo()) {
            console.log(clc.blue.bold("Executing the plan...\n") + clc.green(this.contextManager.getFirstTodo()) + '\n');
            await this.executeATask();
            console.log(clc.blue.bold("Reflecting on the actions taken...\n"));
            await this.reflection();
            console.log(clc.blue.bold("Current plan:\n") + clc.green(this.contextManager.todos.join('\n')) + '\n');
        }
    }

    async simpleApproach(with_reflection: boolean = true) {
        // first, we extract files and workspace structure summary
        let fs_str = await this.contextManager.getWorkspaceStructure(this.env);
        let ext_tree = 'Extended tree:\n$ tree -L 4 .\n' + await this.env.runCommand('tree -L 4 .') + '\n';
        let res = await callLLMFast(`We need to fix the issue in the codebase. Here is the repository structure and the objective:
<ws-structure>
${fs_str}
${ext_tree}
</ws-structure>
<objective>${this.contextManager.objective}</objective>
I need you to respond with several things inside the <result></result> tag. 
First, give me a project description, saying what the project does overall, and the analysis of the issue: why it might be happening, which parts of the project are related to that, and so on. Do that inside <analysis></analysis> tags.
Then, please, give me a list of files that might be relevant to the issue. This includes files that should be read to understand the issue and files that should be written to fix it. You should write like 4-5 files. Write them as a list of paths, inside <relevant_files> tags, with each path inside a <path> tag.
Then, write a slightly shorter overview of the workspace in a format similar to the one above. Focus on the parts that will be relevant to the issue. Write this inside a <ws-structure></ws-structure> tag. It should include most of the paths and some of the content of the files, similar to the original.
Then, give some comands that would be helpful to run to find out what the issue is about - usually, this is about tests. Write them inside <helpful_commands></helpful_commands> tags.
To sum up, you should have four blocks: one with the workspace structure summary, one with the analysis of the issue, one with some helpful commands, and one with the list of relevant files.
${haiku_simple_additional_prompt}

Your answer should be in this format:
<result>
<analysis>
Description of the project and analysis of the issue
</analysis>
<relevant_files>
<path>write_a_relevant_file_here.txt</path>
<path>file2.py</path>
<path>yet_another_file.md</path>
<path>file4.py</path>
<path>file_5.py</path>
</relevant_files>
<ws-structure>
Summary of the workspace structure (you should have the actual summary here)
</ws-structure>
<helpful_commands>
<command>python -m unittest test_file.py</command>
<command>./tests/runtests.py --verbosity 2 module.test_class.test_method</command>
<command>pytest --no-header -rA --tb=no -p no:cacheprovider TEST_FILE</command>
<command>ls some_folder_maybe</command>
<command>grep something something</command>
</helpful_commands>
</result>
`,
            undefined,
            '</result>',
            true,
            '<result>\n<analysis>\n');
        // parse the result
        let projectDescription = res.split('</analysis>')[0].split('<analysis>')[1];
        let workspaceSummary = res.split('</ws-structure>')[0].split('<ws-structure>')[1];
        let relevantFilesStr = res.split('</relevant_files>')[0].split('<relevant_files>')[1];
        let helpfullCommandsStr = res.split('</helpful_commands>')[0].split('<helpful_commands>')[1];
        let relevantFiles = relevantFilesStr.split('</path>').map((path) => path.split('<path>')[1]);
        relevantFiles = relevantFiles.slice(0, -1);
        let relevantFilesContent = [];
        for (let file of relevantFiles) {
            let fileContent = ((await this.env.getFileSystem()).getByPath(file)?.content || []).join('\n');
            relevantFilesContent.push(`<file>\n<path>${file}</path>\n<content>${fileContent}</content>\n</file>`);
        }
        let helpfulCommands = helpfullCommandsStr.split('</command>').map((command) => command.split('<command>')[1]);
        helpfulCommands = helpfulCommands.slice(0, -1);
        let helpfulCommandsOutput = [];
        for (let command of helpfulCommands) {
            let output = `$ ${command}\n${trimString(await this.env.runCommand(command), 1000)}`;
            helpfulCommandsOutput.push(output);
        }
        console.log(projectDescription);
        console.log(workspaceSummary);
        console.log(relevantFiles);
        console.log(helpfulCommandsOutput);
        let result = await callLLM(`You are a world-class software developer with ridiculous level of attention to detail. We need to fix the issue in the codebase. Here is the repository structure and the objective:
<ws-structure>
${fs_str.replace('...', '|skip|').replace('...', '|skip|')}
</ws-structure>
<objective>${this.contextManager.objective}</objective>
Here is some analysis of the issue and the project:
<analysis>
${projectDescription}
${workspaceSummary}
</analysis>
<helpful_commands_output>
${helpfulCommandsOutput.join('\n')}
</helpful_commands_output>
Here is the content of the relevant files:
<relevant_files>
${relevantFilesContent.join('\n')}
</relevant_files>
Please, take a deep breath and write your thoughts on how to fix the issue. After that, write the complete content of the files that need to be written to fix the issue, and then some commands which would be helpful to understand whether the issue was fixed (tests etc), in this format:
<thoughts>
Your thoughts here
</thoughts>
<write_files>
<file>
<path>file1.py</path>
<content>
The content of the file here
From the first line to the last
Repeating the file with the changes
Without skipping any code
You can include blocks of the original file using the following syntax:
<insert-block start_line=X end_line=Y/>
where X and Y are the start and end line numbers (inclusive and 1-indexed) of the block you want to include from the original file.
</content>
</file>
<file>
<path>file2.txt</path>
<content>
<insert-block start_line=1 end_line=100/>
the 101th line of the new file
and so on
in this case, since we have 101 in the next block, these four lines will be inserted between the old 100th and 101st lines
and here will be another block:
<insert-block start_line=101 end_line=200/>
Make sure the content here should actually go right after the 200th line of the original file. BE CAREFUL HERE
The blocks are with both ends included and 1-indexed
And now we include another block from later in the file, thereby replacing lines 201 to 250 with these two
<insert-block start_line=251 end_line=289/>
Some more lines here
And then we continue until the last one of the original file
<insert-block start_line=290 end_line=end/>
</content>
</file>
</write_files>
<helpful_commands>
<command>ls -l</command>
<command>pytest --no-header -rA --tb=no -p no:cacheprovider TEST_FILE</command>
</helpful_commands>

Remember that you cannot use "..." in your answer to skip anything
IF YOU USE "..." IN YOUR ANSWER OR WRITE INVALID FILE CONTENT OR SKIP ANYTHING WITHOUT AN insert-block, YOU WILL BE OBLITERATED.
`, opus_model, '</helpful_commands>', true, '<thoughts>');
        // parse the result
        let thoughts = result.split('</thoughts>')[0].split('<thoughts>')[1];
        console.log(thoughts);
        let filesContentStr = result.split('</write_files>')[0].split('<write_files>')[1];
        console.log(filesContentStr);

        console.log(clc.blue.bold("Entire output:"));
        console.log(result);
        let filesContentStr2 = filesContentStr.split('</file>').map((file) => file.split('<file>')[1]);
        let filesContent = [];
        let fileContentMap: Record<string, string> = {};
        for (let file of filesContentStr2.slice(0, -1)) {
            let path = file.split('</path>')[0].split('<path>')[1];
            let content = file.split('</content>')[0].split('<content>')[1];
            filesContent.push({ path, content: clearLineNums(content) });
            fileContentMap[path] = content;
        }
        for (let file of filesContent) {
            console.log(file.path);
            let originalContent = ((await this.env.getFileSystem()).getByPath(file.path)?.content || []).join('\n');
            let newContent = file.content;
        
            // Replace <insert-block> tags with the corresponding content from the original file
            let insertBlocks = newContent.match(/<insert-block (?:start_line=(\d+) end_line=end|start_line=(\d+) end_line=(\d+))\/>/g);
            if (insertBlocks) {
                for (let block of insertBlocks) {
                    let originalLines = originalContent.split('\n');
                    let [startLineS, endLineS] = block.match(/\d+/g)!;
                    let startLine = Number(startLineS);
                    let endLine;
                    if (endLineS === 'end' || endLineS === undefined || block.includes('end_line=end')) {
                        endLine = originalLines.length;
                    } else {
                        endLine = Number(endLineS);
                    }
                    
                    let blockContent = originalLines.slice(startLine - 1, endLine).join('\n');
                    newContent = newContent.replace(block, blockContent);
                }
            }
        
            this.env.writeFile(file.path, newContent);
        }
        
        if (!with_reflection) {
            console.log('Quitting Clippinator');
            process.exit(0);
        }
        let linter_output = await this.contextManager.getLinterOutput(this.env);
        // Second iteration
        let commandsStr = result.split('</helpful_commands>')[0].split('<helpful_commands>')[1];
        let commands = commandsStr.split('</command>').map((command) => command.split('<command>')[1]);
        commands = commands.slice(0, -1);
        let commandsOutput = [];
        for (let command of commands) {
            let output = await this.env.runCommand(command);
            commandsOutput.push(output);
        }
        let commandsOutputStr = "";
        for (let i = 0; i < commands.length; i++) {
            commandsOutputStr += `$ ${commands[i]}\n${trimString(commandsOutput[i], 1000)}\n`;
        }
        console.log(clc.blue.bold("Commands output:"));
        console.log(commandsOutputStr);
        console.log(clc.blue.bold("Second iteration"));
        let res2 = await callLLM(`We need to fix the issue in the codebase. Here is the repository structure and the objective:
<ws-structure>
${fs_str.replace('...', '|skip|').replace('...', '|skip|')}
</ws-structure>
<objective>${this.contextManager.objective}</objective>
Here is some analysis of the issue and the project:
<analysis>${projectDescription}</analysis>
Here is the content of the relevant files:
<relevant_files>
${relevantFilesContent.join('\n')}
</relevant_files>
Here is a previously proposed solution by the agent:
<files_to_write>
${filesContentStr}
</files_to_write>
Here is the linter output (ignore the formatting!):
<linter_output>
${linter_output}
</linter_output>
And here is the output of some helpful commands:
<commands_output>
${commandsOutputStr}
</commands_output>
Please, review the proposed solution and write your thoughts on it. Evaluate the relevance of the previous response. Offer a better solution if necessary.
After that, write the complete content of the files that need to be written to fix the issue, like this:
<write_files>
<file>
<path>file1.py</path>
<content>
The content of the file here
From the first line to the last
Repeating the file with the changes
Without skipping any code
You can include blocks of the original file using the following syntax:
<insert-block start_line=X end_line=Y/>
where X and Y are the start and end line numbers (inclusive and 1-indexed) of the block you want to include from the original file.
</content>
</file>
<file>
<path>file2.py</path>
<content>
<insert-block start_line=1 end_line=100/>
the 101th line of the new file
and so on
in this case, since we have 101 in the next block, these four lines will be inserted between the old 100th and 101st lines
and here will be another block:
<insert-block start_line=101 end_line=200/>
Make sure the content here should actually go right after the 200th line of the original file. BE CAREFUL HERE
The blocks are with both ends included and 1-indexed
And now we include another block from later in the file, thereby replacing lines 201 to 250 with these two
<insert-block start_line=251 end_line=289/>
Some more lines here
And then we continue until the last one of the original file
<insert-block start_line=290 end_line=end/>
</content>
</file>
</write_files>

Remember that you cannot use "..." in your answer to skip anything
IF YOU USE "..." IN YOUR ANSWER OR WRITE INVALID FILE CONTENT OR SKIP ANYTHING, YOU WILL BE OBLITERATED.
`, "anthropic/claude-3-sonnet:beta", '</write_files>', true, '<thoughts>', true);

        // parse the result
        let thoughts2 = res2.split('</thoughts>')[0].split('<thoughts>')[1];
        let filesContentStr3 = res2.split('</write_files>')[0].split('<write_files>')[1];
        let filesContentStr4 = filesContentStr3.split('</file>').map((file) => file.split('<file>')[1]);
        let filesContent2 = [];
        for (let file of filesContentStr4.slice(0, -1)) {
            let path = file.split('</path>')[0].split('<path>')[1];
            let content = file.split('</content>')[0].split('<content>')[1];
            filesContent2.push({ path, content: clearLineNums(content) });
        }
        console.log(clc.blue.bold("Second iteration output:"));
        console.log(res2);
        for (let file of filesContent2) {
            console.log(file.path);
            let originalContent = fileContentMap[file.path];
            let newContent = file.content;
        
            // Replace <insert-block> tags with the corresponding content from the original file
            let insertBlocks = newContent.match(/<insert-block (?:start_line=(\d+) end_line=end|start_line=(\d+) end_line=(\d+))\/>/g);
            if (insertBlocks) {
                for (let block of insertBlocks) {
                    let originalLines = originalContent.split('\n');
                    let [startLineS, endLineS] = block.match(/\d+/g)!;
                    let startLine = Number(startLineS);
                    let endLine;
                    if (endLineS === 'end' || endLineS === undefined || block.includes('end_line=end')) {
                        endLine = originalLines.length;
                    } else {
                        endLine = Number(endLineS);
                    }
                    
                    let blockContent = originalLines.slice(startLine - 1, endLine).join('\n');
                    newContent = newContent.replace(block, blockContent);
                }
            }
        
            this.env.writeFile(file.path, newContent);
        }
//         console.log(thoughts2);
//         console.log(filesContentStr3);
        console.log('Quitting Clippinator');
        process.exit(0);

        // return await this.run(
        //     'Please, achieve the objective using the tools available. Read the files needed to understand the issue in one <function_calls> call, state your ideas to fix it, write the files to fix it. YOU SHOULD HAVE TWO FUNCTION CALLS BLOCKS: ONE FOR READING ALL FILES, ANOTHER FOR WRITING THEM. After, write <DONE/>.',
        //     undefined,
        //     undefined,
        //     "",
        //     undefined,
        //     ["set_todos", "run_shell_command", "patch_file", "set_memory", "remember"],
        //     opus_model,   // haiku_model,
        //     7
        // )
    }
}
