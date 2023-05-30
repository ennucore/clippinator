import os
from dataclasses import dataclass

from langchain import PromptTemplate
from langchain.chains.combine_documents.base import BaseCombineDocumentsChain
from langchain.chains.summarize import load_summarize_chain
from langchain.chat_models import ChatOpenAI
from langchain.docstore.document import Document
from langchain.text_splitter import (
    RecursiveCharacterTextSplitter,
)

from clippy.tools.tool import SimpleTool
from .code_tools import lint_file


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
    return inp.strip().strip("'").strip().split(": ")[-1].split(", ")[0].strip()


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
        "The tool will completely overwrite the entire file, so be very careful with it, "
        "avoid using it on non-empty files. DO NOT write anything on the first line except the path"
    )

    def __init__(self, wd: str = "."):
        self.workdir = wd

    def func(self, args: str) -> str:
        # Use a regular expression to extract the file path from the input
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

        original_file_path = file_path
        file_path = os.path.join(self.workdir, file_path)

        try:
            # Check if the directory exists, if not create it
            directory = os.path.dirname(file_path)
            if not os.path.exists(directory):
                os.makedirs(directory)

            # Write the content to the file
            with open(file_path, "w") as f:
                f.write(content)

            linter_output = lint_file(file_path)
            if linter_output:
                return f"Successfully written to {original_file_path}. Linter output:\n{linter_output}"

            return f"Successfully written to {original_file_path}."
        except Exception as e:
            return f"Error writing to file: {str(e)}"


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

    def __init__(self, wd: str = "."):
        self.workdir = wd

    def func(self, args: str) -> str:
        try:
            if "[" not in args:
                filename = strip_filename(args)
                with open(os.path.join(self.workdir, filename), "r") as f:
                    lines = f.readlines()
                    lines = [f"{i + 1}|{line}" for i, line in enumerate(lines)]
                    out = "```\n" + "".join(lines) + "\n```"
                    if len(out) > 5000:
                        return (
                                out[:5000]
                                + "\n...\n```\nFile too long, use the summarizer or "
                                  "(preferably) request specific line ranges.\n"
                        )
                    return out
            filename, line_range = args.split("[", 1)
            filename = strip_filename(filename)
            line_ranges = line_range.split("]")[0].split(",")
            line_ranges = [line_range.split(":") for line_range in line_ranges]

            with open(os.path.join(self.workdir, filename.strip()), "r") as f:
                lines = f.readlines()
                line_ranges = [
                    (
                        int(line_range[0].strip().strip('l') or 1) - 1,
                        int(line_range[1].strip().strip('l') or len(lines)))
                    for line_range in line_ranges
                ]
                out = ""
                for line_range in line_ranges:
                    out += "".join(
                        [
                            f"{i + 1}| {lines[i]}"
                            for i in range(line_range[0], min(line_range[1], len(lines)))
                        ]
                    )
                return "```\n" + out + "\n```"
        except Exception as e:
            return f"Error reading file: {str(e)}"


def apply_patch(file_content, patch):
    # Split the content and patch into lines
    content_lines = file_content.strip().split("\n")
    patch_lines = patch.strip().split("\n")

    content_index = 0
    patch_index = 0
    new_content = []
    last_end_line = -1

    while content_index < len(content_lines) or patch_index < len(patch_lines):
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
                else:
                    range_start = range_end = int(range_str)
            except ValueError:
                raise ValueError(
                    "Invalid line range format. Expected '[start-end]' or '[line]'."
                )

            # Convert to 0-indexed
            range_start -= 1
            range_end -= 1
            # End is not inclusive
            range_end -= 1

            if (
                    range_start > range_end + 1
                    or range_start < 0
                    or range_end >= len(content_lines)
            ):
                raise ValueError(
                    f"Invalid line range. Received '{range_start + 1}-{range_end + 2}' for a file with {len(content_lines)} lines."
                )

            # Check if the ranges overlap
            if range_start < last_end_line:
                raise ValueError(
                    f"Line ranges overlap. Previous range ends at line {last_end_line + 1}, but next range starts at line {range_start + 1}."
                )

            last_end_line = range_end

            # Gather the replacement lines
            patch_index += 1
            replacements = []
            while patch_index < len(patch_lines) and not (
                    patch_lines[patch_index].startswith("[")
                    and patch_lines[patch_index].endswith("]")
            ):
                replacements.append(patch_lines[patch_index])
                patch_index += 1

            if patch_index < len(patch_lines) and not replacements:
                raise ValueError("Missing replacement text for line range.")

            # Append lines from content that are before the range
            while content_index < range_start:
                new_content.append(content_lines[content_index])
                content_index += 1

            # Skip lines from content that are within the range
            content_index = range_end + 1

            # Append the replacement lines
            new_content.extend(replacements)
        else:
            # If no range to replace, simply append the line from content
            if content_index < len(content_lines):
                new_content.append(content_lines[content_index])
                content_index += 1

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
        [2-4]
        replacement for lines 2 and 3
        [5]
        insert after line 5 (btw, use [5-6] with nothing after it to delete the fifth line)
        [20-21]
        replacement for line 20
        ```
        The patch lines are applied in order, and the ranges must not overlap or intersect. Any violation of this format will result in an error.
        Make sure to read the relevant part of the file before patching, especially if you're trying to fix something.
        """

    def __init__(self, wd: str = "."):
        self.workdir = wd

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
            new_content = apply_patch(open(filename).read(), patch)
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
