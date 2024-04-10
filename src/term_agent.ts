import { TermTool, TermToolbox, fmtDescription, parseBashCall, submitTool } from "./toolbox/editor";

import { ContextManagerTerm, Event, parseAIResponse } from "./context/context_manager_term";
import { Environment, CLIUserInterface, DummyBrowser, DummyTerminal, TrunkLinter } from "./environment/environment";
import { SimpleTerminal } from './environment/terminal';
import { DefaultFileSystem } from "./environment/filesystem";
import { Tool, ToolCall, clearLineNums, final_result_tool, tool_functions, tools } from "./toolbox/toolbox";
import { APIMessage, callLLM, callLLMFast, callLLMTools, haiku_model, opus_model, sonnet_model } from "./llm";
import { buildRepoInfo, extractTag, filterAdvice, fullAdvice, haiku_simple_additional_prompt, helpful_commands_prompt, planning_examples, simple_approach_additional_advice, task_prompts, write_files_prompt } from "./prompts/promptsXml";
import { commandBan, formatFileContent, runCommands, trimString } from "./utils";
var clc = require("cli-color");


export class ClipinatorTerm {
    env: TermToolbox;
    contextManager: ContextManagerTerm;
    tools: TermTool[];
    commandDesc: string;

    constructor(objective: string = "", path: string = ".") {
        this.contextManager = new ContextManagerTerm(objective);
        this.env = new TermToolbox(new DefaultFileSystem(path), new DummyBrowser(), new SimpleTerminal(path), new CLIUserInterface(), new TrunkLinter(path));
        this.tools = [...this.env.getTools(), submitTool];
        this.commandDesc = this.tools.map(fmtDescription).join('\n');
    }

    async getNextMessage(postfix: Event[] = []): Promise<Event> {
        let messages = [...(await this.contextManager.getHistoryPrefix(this.env, this.commandDesc)),
        ...this.contextManager.history, ...postfix
        ];
        let result = await callLLM(messages.map(val => { return { role: val.type, content: val.content } as APIMessage }), 'openai/gpt-4-turbo-2024-04-09');
        let parsed = parseAIResponse(result);
        if (typeof parsed === 'string') {
            console.log(clc.red(parsed))
            console.log(result)
            return this.getNextMessage([...postfix, { type: "assistant", content: result }, { type: "user", content: this.contextManager.promptManager.getPrompt('format_fail', { error: parsed})}]);
        } else {
            return parsed;
        }
    }

    async runTool(toolInput: string): Promise<Event> {
        let { command, args } = parseBashCall(toolInput);
        if (commandBan(command, args)) {
            return { type: "user", content: commandBan(command, args)! };
        }
        let result;
        let tool = this.tools.find(tool => tool.name === command);
        if (tool) {
            result = await tool.function(tool.parse_args(args), this.contextManager, this.env);
        } else {
            result = await this.env.runCommand(toolInput);
        }
        return this.contextManager.fmtToolOutput(result, this.env);
    }

    async mainLoop(iterations: number = 12) {
        while (!this.contextManager.done && iterations-- > 0) {
            let message = await this.getNextMessage();
            console.log(clc.blue(message.thoughts));
            console.log(clc.green(message.tool_call));
            let toolResult = await this.runTool(message.tool_call!);
            this.contextManager.history.push(message);
            console.log(clc.yellow(toolResult.output));
            this.contextManager.history.push(toolResult);
        }
        console.log(clc.green('Completed!'))
        process.exit(0);
    }
}
