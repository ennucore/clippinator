import { execSync } from "child_process";
import { readFileSync } from "fs";

interface TagKinds {
    [language: string]: string[];
}

interface Tag {
    path: string;
    line: number;
    kind: string;
    language: string;
    formatted?: string;
}

let defaultExec = async (cmd: string) => execSync(cmd).toString();

export async function getTagKinds(
    exec: (cmd: string) => Promise<string> = defaultExec
): Promise<TagKinds> {
    if (tagKindsByLanguage) {
        return tagKindsByLanguage;
    }
    // Run "ctags --list-kinds-full"
    const cmd = ["ctags", "--list-kinds-full"];
    const result = (await exec(cmd.join(" "))).split("\n").slice(1);
    const kinds: TagKinds = {};
    for (const line of result) {
        const [language, _letter, kind] = line.split(/\s+/).slice(0, 3);
        if (!kinds[language]) {
            kinds[language] = [];
        }
        kinds[language].push(kind);
    }
    tagKindsByLanguage = kinds;
    return kinds;
}

let tagKindsByLanguage: TagKinds | null = null;

export async function getFileSummary(
    filePath: string,
    fileLines: string[],
    indent: string = "",
    length1: number = 1000,
    length2: number = 2000,
    exec: (cmd: string) => Promise<string> = defaultExec
): Promise<string> {
    const cmd = ["ctags", "-x", "--output-format=json", "--fields=+n+l", filePath];
    const result = await exec(cmd.join(" "));
    let out = "";
    const lines = result.split("\n").filter((line) => line.trim());
    const tags: Tag[] = lines.map((line) => JSON.parse(line));
    const lengthsByTag: { [kind: string]: number } = {};
    for (const tag of tags) {
        tag.formatted = `${indent}${tag.line}|${fileLines[tag.line - 1]}`;
        lengthsByTag[tag.kind] = (lengthsByTag[tag.kind] || 0) + (tag.formatted.length + 1);
    }
    if (tags.length === 0) {
        return "";
    }
    await getTagKinds(exec);
    const kinds = tagKindsByLanguage![tags[0].language];
    let selectedTags: Tag[] = [];
    for (const kind of kinds) {
        if (lengthsByTag[kind] < length1 || selectedTags.length === 0) {
            selectedTags = selectedTags.concat(tags.filter((tag) => tag.kind === kind));
        }
    }
    selectedTags = selectedTags.sort((a, b) => a.line - b.line);
    const lines2 = selectedTags.map((tag) => [tag.line, `${tag.formatted}\n`]);
    const uniqueLines = lines2.filter(
        (line, index, self) => index === self.findIndex((l) => l[0] === line[0] && l[1] === line[1])
    );
    const sortedLines = uniqueLines.sort((a, b) => (a[0] as number) - (b[0] as number));
    out = sortedLines.map((line) => line[1]).join("");
    if (out.length > length2) {
        out = out.slice(0, length2 - 300) + `\n${indent}...\n` + out.slice(-300);
    }
    return out;
}
