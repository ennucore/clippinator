from __future__ import annotations

import json
import subprocess
from collections import defaultdict


def get_tag_kinds() -> dict[str, list[str]]:
    """
    List tags by language in decreasing order of importance
    """
    # Run "ctags --list-kinds-full"
    cmd = ["ctags", "--list-kinds-full"]
    result = subprocess.run(
        cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True
    ).stdout.splitlines()[1:]
    kinds = defaultdict(list)
    for line in result:
        language, kind = line.split()[0], line.split()[2]
        kinds[language].append(kind)
    return kinds


tag_kinds_by_language = get_tag_kinds()


def get_file_summary(file_path: str, indent: str = "", length_1: int = 1000, length_2: int = 2000) -> str:
    """
    | 72| class A:
    | 80| def create(self, a: str) -> A:
    |100| class B:
    """
    cmd = ["ctags", "-x", "--output-format=json", "--fields=+n+l", file_path]
    result = subprocess.run(
        cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True
    )
    out = ""

    if result.returncode != 0:
        raise RuntimeError(f"Error executing ctags: {result.stderr}")

    try:
        with open(file_path, "r") as f:
            file_lines = f.readlines()
    except UnicodeDecodeError:
        return ""

    lines = result.stdout.splitlines()
    tags = [json.loads(line) for line in lines if line.strip()]
    # Each tag is a dict which has the keys "path", "line", "kind", "language"
    # We need to add kinds in the order of importance such that the total length does not exceed 600 chars
    lengths_by_tag = defaultdict(int)
    for tag in tags:
        tag['formatted'] = f"{indent}{tag['line']}|{file_lines[tag['line'] - 1].rstrip()}"
        lengths_by_tag[tag['kind']] += len(tag['formatted']) + 1
    if len(tags) == 0:
        return ""
    # Get relevant kinds sorted by importance
    kinds = tag_kinds_by_language[tags[0]['language']]
    selected_tags = []
    for kind in kinds:
        if lengths_by_tag[kind] < length_1 or len(selected_tags) == 0:
            selected_tags += [tag for tag in tags if tag['kind'] == kind]
    selected_tags = sorted(selected_tags, key=lambda tag: tag['line'])
    lines = [(tag['line'], f"{tag['formatted']}\n") for tag in selected_tags]
    lines = sorted(set(lines), key=lambda line: line[0])
    lines = [line[1] for line in lines]
    out += ''.join(lines)
    if len(out) > length_2:
        out = out[:length_2 - 300] + f"\n{indent}...\n" + out[-300:]
    return out
