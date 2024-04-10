import { createHash } from 'crypto';
import { Environment } from './environment/environment';

export function hashString(text: string): string {
    const hash = createHash('sha256');
    hash.update(text);
    return hash.digest('hex');
}


/* if the string is too long, trim it, leaving the beginning, then "..." in the middle, then the end, such that its length is equal to the threshold */
export function trimString(text: string, threshold: number): string {
    if (text.length <= threshold) {
        return text;
    }
    const start = text.slice(0, Math.floor(threshold / 2) - 2);
    const end = text.slice(text.length - Math.floor(threshold / 2) + 2);
    return start + '...' + end;
}

export const skip_ext = ['lock', 'png', 'svg', 'pyc'];
export const skip_paths = ['node_modules', '.git', '.trunk', 'linter', '__pycache__', '.github'];


export function saveCache(cache: Record<string, any>, path: string) {
    /* write the cache to a file, do not wait for the process to finish */
    require('fs').writeFile(path, JSON.stringify(cache), (err: any) => {
        if (err) {
            console.error(err);
        }
    });
}

export function loadCache(path: string): Record<string, any> {
    try {
        return JSON.parse(require('fs').readFileSync(path, 'utf8'));
    } catch (e: any) {
        return {};
    }
}

export function formatFileContent(lines: string[], line_threshold: number = 2000, line_range?: {start: number, length: number}): string {
    console.log(`Formatting file content with ${lines.length} lines with ${line_range} (${line_range?.start} ${line_range?.length})`)
    let formattedLines = lines.map((line, index) => `${index + 1}|${line}`);
    if (line_range) {
        formattedLines = formattedLines.slice(line_range.start, line_range.start + line_range.length);
    }
    if (line_threshold != -1 && lines.length > line_threshold) {
        const startLines = formattedLines.slice(0, line_threshold / 2);
        const endLines = formattedLines.slice(-line_threshold / 2);
        formattedLines = [...startLines, '...', ...endLines];
    }
    return formattedLines.join('\n');
}


export function splitN(str: string, sep: string | RegExp, n: number): string[] {
    let parts = str.split(sep);
    let result = parts.slice(0, n - 1);
    if (parts.length >= n) {
        result.push(parts.slice(n - 1).join(sep.toString()));
    }
    return result;
}

export function removePrefix(text: string, prefix: string): string {
    if (text.startsWith(prefix)) {
        return text.slice(prefix.length);
    }
    return text;
}

export function removeSuffix(text: string, suffix: string): string {
    if (text.endsWith(suffix)) {
        return text.slice(0, -suffix.length);
    }
    return text;
}

export async function runCommands(commandsStr: string, env: Environment) {
    let helpfulCommands = commandsStr ? commandsStr.split('</command>').map((command) => command.split('<command>')[1]).slice(0, -1) : [];
    let helpfulCommandsOutput = [];
    for (let command of helpfulCommands) {
        let output = `$ ${command}\n${trimString(await env.runCommand(command), 1000)}`;
        helpfulCommandsOutput.push(output);
    }
    return helpfulCommandsOutput.join('\n');
}

export function formatTemplate(template: string, variables: { [key: string]: string }): string {
    return template.replace(/{(\w+)}/g, (match, key) => variables[key] || match);
}

export function commandBan(command: string, args: string): string | null {
    if (["vim", "vi", "nano", "git"].includes(command)) {
        return `Command ${command} is banned because it's interactive`;
    }
    if (["python", "python3", "sh", "bash"].includes(command) && !args.trim()) {
        return `Command ${command} cannot be run in interactive mode (without arguments)`;
    }
    return null;
}
