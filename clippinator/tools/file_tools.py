import os
from dataclasses import dataclass
from typing import Any

from langchain import PromptTemplate
from langchain.chains.combine_documents.base import BaseCombineDocumentsChain
from langchain.chains.summarize import load_summarize_chain
from langchain.chat_models import ChatOpenAI
from langchain.docstore.document import Document
from langchain.text_splitter import (
    RecursiveCharacterTextSplitter,
)

from clippinator.tools.tool import SimpleTool
from .utils import trim_extra, unjson


def strip_quotes(inp: str) -> str:
    inp = inp.strip()
    if ": " in inp.split("\n", 1)[0] and (
            "``" in inp.split("\n", 1)[0] or "'''" in inp.split("\n", 1)[0]
    ):
        inp = inp.split(": ", 1)[-1].strip()
    if inp.startswith("```"):
        inp = inp.split("\n", 1)[1].removesuffix("```")
    elif inp.startswith("'''"):
        inp = inp.removeprefix("'''").strip().removesuffix("'''")
    return inp


def strip_filename(inp: str) -> str:
    inp = inp.split("=")[-1]
    return inp.strip().strip("'").strip().split(": ")[-1].split(", ")[0].strip().removeprefix('/')


patch_example = """Action: ReadFile
Action Input: filename[10:60]
AResult:
<lines will be here. Now you can patch the file>
Action: PatchFile
Action Input: filename
[2-4]
def greet(name):  
    print("Hello, " + name + "!")
[5]
    a = 123
    c = 789
AResult: Patched successfully
Action: ReadFile
Action Input: filename[10:60]
AResult: <check that it's okay>"""


@dataclass
class WriteFile(SimpleTool):
    """
    A tool that can be used to write files.
    """

    name = "WriteFile"
    description = (
        "a tool that can be used to write (OVERWRITE) files. "
        "The input format is 'dir/filename' (the path is relative to the project directory) on the first "
        "line, "
        "and starting from the next line the desired content without any quotes or other formatting. "
        "The tool will completely overwrite the entire file, so be very careful with it "
        "(read the file before rewriting if it exists). "
        "DO NOT write anything on the first line except the path"
    )
    structured_desc = (
        "a tool that can be used to write (OVERWRITE) files. "
        "It accepts {filename: content} as input (filenames and contents are strings). "
        "The tool will completely overwrite the entire file, so be very careful with it, "
        "avoid using it on non-empty files. "
    )

    def __init__(self, project):
        self.project = project
        self.workdir = project.path

    def structured_func(self, to_write: dict[str, str] | Any):
        to_write = unjson(to_write)
        result = ""
        for filename, content in to_write.items():
            filename = strip_filename(filename)
            file_path = os.path.join(self.workdir, filename)
            try:
                directory = os.path.dirname(file_path)
                if not os.path.exists(directory):
                    os.makedirs(directory)

                # Write the content to the file
                with open(file_path, "w") as f:
                    f.write(content)

                linter_output = self.project.lint_file(file_path)
                if linter_output:
                    result += f"Successfully written to {filename}. Linter output:\n{linter_output}\n\n"

                result += f"Successfully written to {filename}.\n\n"
            except Exception as e:
                result += f"Error writing to {filename}: {str(e)}\n\n"
        return result.strip()

    def func(self, args: str) -> str:
        # Use a regular expression to extract the file path from the input

        print(args)

        first_line, other_lines = args.split("\n", 1)
        first_line = (
            first_line.replace("path=", "")
            .replace("filename=", "")
            .replace("content=", "")
        )
        args = first_line + "\n" + other_lines
        if "\n" not in args:
            file_path = strip_filename(args)
            content = ""
            with open(os.path.join(self.workdir, file_path), "w") as f:
                f.write(content)
                return "Created an empty file."
        file_path, content = args.split("\n", 1)
        file_path = strip_filename(file_path)
        content = strip_quotes(content)
        if all("|" in line[:5] or not line.strip() for line in content.split("\n")):
            content = "\n".join(
                line.split("|", 1)[1] if line.strip() else line
                for line in content.split("\n")
            )
        return self.structured_func({file_path: content})


@dataclass
class ReadFile(SimpleTool):
    """
    A tool that can be used to read files.
    """

    name = "ReadFile"
    description = (
        "a tool that can be used to read files. The input is just the file path. "
        "Optionally, you can add [l1:l2] to the end of the file path to specify a range of lines to read."
    )
    structured_desc = (
        "a tool that can be used to read files. "
        "It accepts a list as input, where each element is either a filename string or an object of the form "
        "{'filename': filename, 'start': int, 'end': int}. Start and end are line numbers from which to read. "
        "If only a filename is provided, the entire file will be read. "
        "Example input: ['file1.py', {'filename': 'file2.py', 'start': 10, 'end': 20}]"
    )

    def __init__(self, wd: str = "."):
        self.workdir = wd

    def structured_func(self, to_read: list[str | dict[str, str | int] | Any]):
        if '{' in str(to_read):
            to_read = unjson(to_read)
        if isinstance(to_read, str):
            to_read = [to_read]
        result = ''
        for item in to_read:
            if isinstance(item, str):
                # same behavior as before, but without using func
                item = strip_filename(item)
                try:
                    with open(os.path.join(self.workdir, item), "r") as f:
                        lines = f.readlines()
                        lines = [f"{i + 1}|{line}" for i, line in enumerate(lines)]
                        out = "```\n" + "".join(lines) + "\n```"
                        if len(out) > 7000:
                            result += (
                                    trim_extra(out, 7000)
                                    + "\n```\nFile too long, use the summarizer or "
                                      "(preferably) request specific line ranges.\n\n"
                            )
                        else:
                            result += out + '\n\n'
                except Exception as e:
                    result += f"Error reading file: {str(e)}\n\n"
            elif isinstance(item, dict):
                # read a specific range
                try:
                    filename = strip_filename(item['filename'])
                    start = item.get('start', 1)
                    end = item.get('end', None)
                    with open(os.path.join(self.workdir, filename), "r") as f:
                        lines = f.readlines()
                        lines = [f"{i + 1}|{line}" for i, line in enumerate(lines)]
                        out = "```\n" + "".join(lines[start - 1:end]) + "\n```"
                        if len(out) > 6000:
                            result += (
                                    trim_extra(out, 6000)
                                    + "\n...\nFile too long, use the summarizer or "
                                      "(preferably) request specific line ranges.\n\n"
                            )
                        else:
                            result += out + '\n\n'
                except Exception as e:
                    result += f"Error reading file: {str(e)}\n\n"
        return result.strip()

    def func(self, args: str) -> str:
        if not args.endswith(']'):
            filename = strip_filename(args)
            return self.structured_func([filename])
        filename, line_range = args.split("[", 1)
        filename = strip_filename(filename)
        line_ranges = line_range.split("]")[0].split(",")
        line_ranges = [line_range.split(":") for line_range in line_ranges]
        line_ranges = [
            (
                int(line_range[0].strip().strip('l') or 1) - 1,
                int(line_range[1].strip().strip('l') or None))
            for line_range in line_ranges
        ]
        return self.structured_func([{'filename': filename, 'start': start, 'end': end} for start, end in line_ranges])


def parse_patch(patch):
    # Split the patch into lines
    patch_lines = patch.strip().split("\n")

    patch_index = 0
    patches = []

    while patch_index < len(patch_lines):
        if (
                patch_index < len(patch_lines)
                and patch_lines[patch_index].startswith("[")
                and patch_lines[patch_index].endswith("]")
        ):
            # Parse the range from the patch
            range_str = patch_lines[patch_index][1:-1]
            try:
                if "-" in range_str:
                    range_start, range_end = map(int, range_str.split("-"))
                    type = 'remove' if range_start == range_end else 'replace'
                else:
                    range_start = range_end = int(range_str)
                    type = 'insert'
                    range_end -= 1
            except ValueError:
                raise ValueError(
                    "Invalid line range format. Expected '[start-end]' or '[line]'."
                )

            # Convert to 0-indexed
            range_start -= 1
            range_end -= 1

            # Gather the replacement lines
            patch_index += 1
            replacements = []
            while patch_index < len(patch_lines) and not (
                    patch_lines[patch_index].startswith("[")
                    and patch_lines[patch_index].endswith("]")
            ):
                replacements.append(patch_lines[patch_index])
                patch_index += 1

            patch_dict = {'type': type, 'start': range_start, 'end': range_end}
            if replacements:
                patch_dict['content'] = "\n".join(replacements)

            patches.append(patch_dict)
    return patches


def apply_patch_str(file_content: str, patch: str):
    patches = parse_patch(patch)
    return apply_patch(file_content, patches)


def apply_patch(file_content: str, patches: list[dict[str, Any]]):
    # Split the content into lines
    content_lines = file_content.strip().split("\n")

    new_content = []
    last_end_line = -1

    for patch in patches:
        # Check if the ranges overlap
        if patch['start'] <= last_end_line:
            raise ValueError(
                f"Line ranges overlap. Previous range ends at line {last_end_line + 1}, but next range starts at line {patch['start'] + 1}."
            )

        last_end_line = patch['end']

        # Append lines from content that are before the range
        while last_end_line < patch['start']:
            new_content.append(content_lines[last_end_line])
            last_end_line += 1

        # Handle replace and remove
        if patch['type'] in ('replace', 'remove'):
            # Skip lines from content that are within the range
            last_end_line = patch['end'] + 1

            # Append the replacement lines
            if patch['type'] == 'replace':
                new_content.extend(patch['content'].split("\n"))

        # Handle insert
        elif patch['type'] == 'insert':
            new_content.extend(patch['content'].split("\n"))

    # Append any remaining lines from content
    new_content.extend(content_lines[last_end_line:])

    return "\n".join(new_content)


@dataclass
class PatchFile(SimpleTool):
    """
    A tool that can be used to patch files.
    """

    name = "PatchFile"
    description = """
The patch format is a text-based representation designed to apply modifications to another text, typically source code. 
Each modification is represented by a line range to be replaced, followed by the replacement content. 
The line range is specified in brackets, such as [start-end] to replace from start to end (10-20 will erase lines 10, 11, ..., 19, 1-indexed, and replace them by the new content) or [line] to insert a line after the specified line, where the line numbers are 1-indexed. 
The replacement content follows the line range and can span multiple lines. Here is a sample patch:
```
[2-3]
replacement for lines 2 and 3
[5]
insert after line 5 (btw, use [5-5] with nothing after it if you want to delete the fifth line)
[20-20]
replacement for line 20
```
The patch lines are applied in order, and the ranges must not overlap or intersect. Any violation of this format will result in an error.
Make sure to read the relevant part of the file before patching, especially if you're trying to fix something.
"""
    structured_desc = """
The patch tool is used to apply modifications to a file. It takes the filename and the changes. 
The patches are a list of modifications, each of them can be one of the following:
{'type': 'remove', 'start': line number from which to delete, 'end': ...}: to delete lines from the content. The 'start' and 'end' keys specify the range of lines to be deleted (0-indexed). 
{'type': 'replace', 'start' ..., 'end': ..., 'content': 'new content here'}: to replace lines in the content. The 'start' and 'end' keys specify the range of lines to be replaced, and the 'content' key provides the new content.
{'type': 'insert', 'after_line': ..., 'content': '...}: to insert lines into the content. The 'after_line' key specifies the line after which new content will be inserted, and the 'content' key provides the new content.
"""

    def __init__(self, wd: str = "."):
        self.workdir = wd

    def structured_func(self, filename: str, patches: list[dict[str, Any]]) -> str:
        filename = os.path.join(self.workdir, filename)
        try:
            new_content = apply_patch(open(filename).read(), patches)
        except Exception as e:
            return f"Error applying patch: {str(e)}."
        with open(filename, "w") as file:
            file.write(new_content)
        return f"Successfully patched {filename}."

    def func(self, args: str) -> str:
        if "\n" not in strip_quotes(args):
            return (
                    "Error: no newline found in input. "
                    "The first line should be the filename, the rest should be the patch."
                    " Here is an example of patching:\n" + patch_example
            )
        filename, patch = strip_quotes(args).split("\n", 1)
        filename = strip_filename(filename)
        patch = strip_quotes(patch)
        filename = os.path.join(self.workdir, filename.strip())
        try:
            new_content = apply_patch_str(open(filename).read(), patch)
        except Exception as e:
            return f"Error applying patch: {str(e)}. Here's a reminder on how to patch:\n{patch_example}"
        with open(filename, "w") as file:
            file.write(new_content)
        return f"Successfully patched {filename}."


mr_prompt_template = """You need to write a summary of the content of a file. You should provide an overview of what this file contains (classes, functions, content, etc.)
Keep the line numbers, for instance, this is how your output should look like (output just that and nothing else) - this example is for a Python file:
50| class Prompt - a class for a prompt that ...
53| def format(self, **kwargs) - a method that formats the prompt
80| class Toolkit - ....

Note that if the file contains some text information/content, you should summarize it too (but include line numbers as well).

Here is the content (it may include the file and previously summarized content) you should summarize:

{text}
"""


@dataclass
class SummarizeFile(SimpleTool):
    """
    A tool that can be used to summarize files.
    """

    name = "SummarizeFile"
    description = (
        "a tool that can be used to summarize files. The input is just the file path."
    )
    summary_agent: BaseCombineDocumentsChain
    text_splitter: RecursiveCharacterTextSplitter

    def __init__(self, wd: str = ".", model_name: str = "gpt-3.5-turbo"):
        self.workdir = wd
        mr_prompt = PromptTemplate(
            template=mr_prompt_template, input_variables=["text"]
        )
        self.summary_agent = load_summarize_chain(
            ChatOpenAI(model_name=model_name, request_timeout=140),
            chain_type="map_reduce",
            map_prompt=mr_prompt,
            combine_prompt=mr_prompt,
        )
        self.text_splitter = RecursiveCharacterTextSplitter()

    def func(self, args: str) -> str:
        try:
            with open(os.path.join(self.workdir, strip_filename(args)), "r") as f:
                inp = f.readlines()
                inp = "".join([f"{i + 1}| {line}" for i, line in enumerate(inp)])
                texts = self.text_splitter.split_text(inp)
                docs = [Document(page_content=t) for t in texts]
                result = self.summary_agent.run(docs)
                if len(result) > 4000:
                    texts_2 = self.text_splitter.split_text(result)
                    docs_2 = [Document(page_content=t) for t in texts_2]
                    result = self.summary_agent.run(docs_2)
                return f"```\n{result}\n```"
        except Exception as e:
            return f"Error reading file: {str(e)}"
