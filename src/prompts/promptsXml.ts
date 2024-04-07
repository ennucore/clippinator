import { readFileSync } from "fs";
import { callLLMFast } from "../llm";

import * as yaml from 'js-yaml';
import * as fs from 'fs';

interface PromptsXml {
  planning_examples: string;
  task_prompts: string;
  haiku_simple_additional_prompt: string;
  simple_approach_additional_advice: string;
  helpful_commands_prompt: string;
  write_files_prompt: string;
}

const promptsYaml = fs.readFileSync('src/prompts_xml.yaml', 'utf8');
const prompts: PromptsXml = yaml.load(promptsYaml) as PromptsXml;

export const planning_examples = prompts.planning_examples;
export const task_prompts = prompts.task_prompts;
export const haiku_simple_additional_prompt = prompts.haiku_simple_additional_prompt;
export const simple_approach_additional_advice = prompts.simple_approach_additional_advice;
export const helpful_commands_prompt = prompts.helpful_commands_prompt;
export const write_files_prompt = prompts.write_files_prompt;

const repoInfoTemplate = `<ws-structure>
{fs_str}
</ws-structure>
<objective>{objective}</objective>
Here is some analysis of the issue and the project:
<analysis>
{projectDescription}
{workspaceSummary}
</analysis>
Here is the content of the relevant files:
<relevant_files>
{relevantFilesContent}
</relevant_files>
<helpful_commands_output>
{helpfulCommandsOutput}
</helpful_commands_output>
`;

export function buildRepoInfo(fs_str: string, objective: string, projectDescription: string, workspaceSummary: string, relevantFilesContent: string[], helpfulCommandsOutput: string): string {
  const formattedFsStr = fs_str.replace(/\.\.\./g, '|skip|');
  const formattedRelevantFilesContent = relevantFilesContent.join('\n');

  return repoInfoTemplate
    .replace('{fs_str}', formattedFsStr)
    .replace('{objective}', objective)
    .replace('{projectDescription}', projectDescription)
    .replace('{workspaceSummary}', workspaceSummary)
    .replace('{relevantFilesContent}', formattedRelevantFilesContent)
    .replace('{helpfulCommandsOutput}', helpfulCommandsOutput);
}

const filterAdvicePrompt = (repo_info: string, advice: string) => `We are working on a task in a repository.
Here is a lot of advice for a lot of different tasks and situations:
<advice>
${advice}
</advice>

Filter the advice relevant for the current task using the following information:
${repo_info}

Answer only with the relevant advice.
`;


export function extractTag(res: string, tag: string) {
    return res.split(`</${tag}>`)[0].split(`<${tag}>`)[1];
}

export async function filterAdvice(repo_info: string, full_advice: string) {
    // We split the advice into pieces by lines such that each piece is no longer that 100k characters
    if (!full_advice.length) {
        return '';
    }
    let advice_lines = full_advice.split('\n');
    let advice_pieces = [];
    let current_piece = '';
    for (let line of advice_lines) {
        if (current_piece.length + line.length > 100000) {
            advice_pieces.push(current_piece);
            current_piece = '';
        }
        current_piece += line + '\n';
    }
    advice_pieces.push(current_piece);
    // now we filter the advice by running each piece through Haiku using callLLMFast **in parallel**
    let promises = advice_pieces.map((piece) => callLLMFast(filterAdvicePrompt(repo_info, piece), undefined, undefined, false, "Relevant advice:"));
    let results = await Promise.all(promises);
    return results.map((res) => res.replace('Relevant advice:', '').trim()).join('\n');
}


// load promptyara.txt
export const fullAdvice = '';   // readFileSync('promptyara.txt', 'utf8');
