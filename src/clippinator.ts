import { ContextManager, Message } from "./context/context_management";
import { Environment, CLIUserInterface, DummyBrowser, DummyTerminal, TrunkLinter } from "./environment/environment";
import { SimpleTerminal } from './environment/terminal';
import { DefaultFileSystem } from "./environment/filesystem";
import { Tool, ToolCall, clearLineNums, final_result_tool, tool_functions, tools } from "./toolbox";
import { callLLM, callLLMFast, callLLMTools, haiku_model, opus_model, sonnet_model } from "./llm";
import { buildRepoInfo, extractTag, filterAdvice, fullAdvice, haiku_simple_additional_prompt, helpful_commands_prompt, planning_examples, simple_approach_additional_advice, task_prompts, write_files_prompt } from "./prompts";
import { formatFileContent, runCommands, trimString } from "./utils";
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

    async simpleApproach(with_reflection: boolean = false) {
        // first, we extract files and workspace structure summary
        let fs_str = trimString(await this.contextManager.getWorkspaceStructure(this.env), 30000);
        let ext_tree = 'Extended tree:\n$ tree -L 4 .\n' + trimString(await this.env.runCommand('tree -L 4 .'), 100000) + '\n';
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
</relevant_files>
<ws-structure>
Summary of the workspace structure (you should have the actual summary here)
</ws-structure>
${helpful_commands_prompt}
</result>
`,
            undefined,
            '</result>',
            true,
            '<result>\n<analysis>\n');
        // parse the result
        let projectDescription = extractTag(res, 'analysis');
        let workspaceSummary = extractTag(res, 'ws-structure');
        let relevantFilesStr = extractTag(res, 'relevant_files');
        let relevantFiles = relevantFilesStr.split('</path>').map((path) => path.split('<path>')[1]).slice(0, -1);
        let relevantFilesContent = [];
        let originalContentMap = new Map<string, string[]>();
        for (let file of relevantFiles) {
            originalContentMap.set(file, (await this.env.getFileSystem()).getByPath(file)?.content || []);
            let fileContent = trimString(formatFileContent(originalContentMap.get(file)!, 10000), 30000);
            relevantFilesContent.push(`<file>\n<path>${file}</path>\n<content>${fileContent}</content>\n</file>`);
        }
        let helpfulCommandsOutput = await runCommands(extractTag(res, 'helpful_commands'), this.env);
        console.log(projectDescription);
        console.log(workspaceSummary);
        console.log(relevantFiles);
        console.log(helpfulCommandsOutput);
        let repo_info = buildRepoInfo(fs_str, this.contextManager.objective, projectDescription, workspaceSummary, relevantFilesContent, helpfulCommandsOutput);
        let advice = await filterAdvice(repo_info, fullAdvice);
        console.log(clc.green(advice))
        let result = await callLLM(`You are a world-class software developer with ridiculous level of attention to detail. We need to fix the issue in the codebase. Here is the repository structure and the objective:
${repo_info}

Some advice:
<advice>
${advice}
</advice>

Please, take a deep breath and write your thoughts on how to fix the issue. After that, write the complete content of the files that need to be written to fix the issue, and then some commands which would be helpful to understand whether the issue was fixed (tests etc), in this format:
<thoughts>
Your thoughts here on what the issue is and what you need to do.
E.g.: The issue described is happening, because the variable ... in line ... is happening incorrectly. To fix it, we need to change the variable ... to ... in line ... in the file ... and add a new function ... in the file ... to handle the new variable.
Write here what kind of changes you will make in the codebase to fix the issue. In particular, say which files you'll need to write, and what want to change in them.

After that, write a description of what you want to change in each file in a <write_files> block like below.

${simple_approach_additional_advice}

</thoughts>
${write_files_prompt}
${helpful_commands_prompt}
`, "openai/gpt-4-turbo-preview", '</helpful_commands>', false, '<thoughts>', false);
        let filesContentStr = result.split('</write_files>')[0].split('<write_files>')[1];
        console.log(clc.blue.bold("Entire output:"));
        console.log(result);

        let filesContentFixed = await handleFilesLLM(filesContentStr, originalContentMap, this.env, repo_info, extractTag(result, 'thoughts'));
        console.log('<CLIPPINATOR-S1-DIFF>');
        console.log(await this.env.runCommand('git diff | cat'));
        console.log('\n</CLIPPINATOR-S1-DIFF>');

        if (!with_reflection) {
            console.log('Quitting Clippinator');
            process.exit(0);
        }
        let linter_output = trimString(await this.contextManager.getLinterOutput(this.env), 15000);
        // Second iteration
        
        let commandsOutputStr = await runCommands(extractTag(res, 'helpful_commands'), this.env);
        console.log(clc.blue.bold("Commands output:"));
        console.log(commandsOutputStr);
        console.log(clc.blue.bold("Second iteration"));
        let res2 = await callLLM(`We need to fix the issue in the codebase. Here is the repository structure and the objective:
${repo_info}
Some changes were made to the files to fix the issue:
<changes>
${filesContentStr}
</changes>
Which comes down to this file content:
<files_to_write>
${filesContentFixed}
</files_to_write>
Here is the linter output (ignore the formatting!):
<linter_output>
${linter_output}
</linter_output>
And here is the output of some helpful commands:
<commands_output>
${commandsOutputStr}
</commands_output>

Advice:
<advice>
${advice}
</advice>


Please, take a deep breath and review the proposed solution and write your thoughts on it. Evaluate the relevance of the previous response. Offer a better solution if necessary.
First, think about what might be wrong (look at the output of the commands and the linter) and whether you need to fix anything. If not, just write <write_files></write_files> and we're done.
If you need to fix something, write your thoughts on the changes you need to make.

After that, write the changes that need to be made to the original files to fix the issue. Write the patches (differences) between the original files and the ones that are needed.

${simple_approach_additional_advice}

<thoughts>
Your thoughts here on the proposed solution, what might be wrong with it, what might be the cause of the issue, and what needs to be changed compared to the files in the <files_to_write> block.
</thoughts>
${write_files_prompt}
`, "openai/gpt-4-turbo-preview", '</write_files>', true, '<thoughts>', false);

        // parse the result
        let thoughts2 = res2.split('</thoughts>')[0].split('<thoughts>')[1];
        let filesContentStr3 = res2.split('</write_files>')[0].split('<write_files>')[1];
        console.log(clc.blue.bold("Second iteration output:"));
        console.log(res2);

        handleFilesLLM(filesContentStr3, originalContentMap, this.env, repo_info + `
Some changes were made to the files to fix the issue:
<changes>
${filesContentStr}
</changes>

<linter_output>\n${linter_output}\n</linter_output>
<helpful_commands_output>${commandsOutputStr}</helpful_commands_output>`, thoughts2);
        console.log('<CLIPPINATOR-S2-DIFF>');
        console.log(await this.env.runCommand('git diff | cat'));
        console.log('\n</CLIPPINATOR-S2-DIFF>');
        process.exit(0);
    }
}



async function handleFiles(filesContentStr: string, originalContentMap: Map<string, string[]>, env: Environment) {
    let filesContentStr2 = filesContentStr.split('</file>').map((file) => file.split('<file>')[file.split('<file>').length - 1]);
    let filesContent = [];
    let fileContentMap: Record<string, string> = {};
    for (let file of filesContentStr2.slice(0, -1)) {
        let path = file.split('</path>')[0].split('<path>')[1];
        let content = file.split('</content>')[0].split('<content>')[1];
        filesContent.push({ path, content: clearLineNums(content) });
        fileContentMap[path] = content;
    }
    let filesContentFixed = '';
    for (let file of filesContent) {
        console.log(file.path);
        let originalContent = (originalContentMap.get(file.path) || ((await env.getFileSystem()).getByPath(file.path)?.content || [])).join('\n');;
        if (!file.content.trim()) {
            continue;
        }
        let blocks = file.content.split("<insert-block ");
        let newContent = blocks[0];
        for (let i = 1; i < blocks.length; i++) {
            let block = blocks[i];
            let startLine = parseInt(block.split("start_line=")[1].split(" ")[0]);
            let endLineS = block.split("end_line=")[1].split("/")[0].split(">")[0];
            let endLine = endLineS === "end" ? originalContent.split('\n').length : parseInt(endLineS);
            let blockContent = originalContent.split('\n').slice(startLine - 1, endLine).join('\n');
            newContent += blockContent;
            // if there is "/>" before the first ">"
            if (block.split("end_line=")[1].split("/")[0].includes(">")) {
                newContent += block.split("</insert-block>")[1] || "";
            } else {
                newContent += block.split(">", 2)[1];
            }
        }
        filesContentFixed += `<file>\n<path>${file.path}</path>\n<content>\n${trimString(newContent, 60000)}\n</content>\n</file>\n`;
        env.writeFile(file.path, newContent);
    }
    return filesContentFixed;
};



async function handleFilesLLM(filesContentStr: string, originalContentMap: Map<string, string[]>, env: Environment, repo_info: string, thoughts: string) {
    filesContentStr = filesContentStr.replace('patch>', 'suggested_code>');
    let res = await callLLMFast(`You are a world-class software developer with ridiculous level of attention to detail. We need to fix the issue in the codebase. Here is the repository structure and the objective:

${repo_info}

Here are some thoughts about the issue:
<thoughts>
${thoughts}
</thoughts>

You need to rewrite the files, providing the full content of the files with some changes implemented in them in order to fix the issue. 
Here are the changes you need to make:
<file_changes>
${filesContentStr}
</file_changes>

Please, respond in the following format with the new content of the files:
<write_files>
<file>
<path>file1.py</path>
<content>
import something
import that


# The content of the file here
# From the first line to the last
# Repeating the file with the changes
# Apply the suggested code changes and so on
# Very carefully fixing the issue

def some_function():
    return f2(5)
</content>
</file>
<file>
<path>file2.txt</path>
<content>
The content of the second file here, changed according to file_changes
From the first line to the last
Potentially thousands of lines
</content>
</file>
</write_files>
Obviously, you have to write the entire content of the files without skipping anything. If you do something like "# this part is unchanged" or "# ... (the rest of the file remains the same)" YOU WILL BE OBLITERATED.
Just write the correct content for all the files from beginning to the end
`, "anthropic/claude-3-sonnet:beta", '</write_files>', true, '<write_files>\n<file>\n<path>', 15);
    // now, parse and handle the files
    let fullFilesStr = res.split('</write_files>')[0];
    fullFilesStr = res.split('<write_files>')[res.split('<write_files>').length - 1];
    return await handleFiles(fullFilesStr, originalContentMap, env);

}
