import os
from dataclasses import dataclass
from typing import Tuple

from langchain import PromptTemplate
from langchain.chains.combine_documents.base import BaseCombineDocumentsChain
from langchain.chains.summarize import load_summarize_chain
from langchain.chat_models import ChatOpenAI
from langchain.docstore.document import Document
from langchain.text_splitter import (
    RecursiveCharacterTextSplitter,
)

from clippy.tools.tool import SimpleTool


def strip_quotes(inp: str) -> str:
    inp = inp.strip()
    inp = inp.removeprefix("```").removeprefix("'''").removeprefix('"""').strip()
    inp = inp.removesuffix("\n```").removesuffix("\n'''").removesuffix('\n"""')
    return inp


@dataclass
class WriteFile(SimpleTool):
    """
    A tool that can be used to write files.
    """

    name = "WriteFile"
    description = (
        "a tool that can be used to write files. "
        "The input format is 'dir/filename' (the path is relative to the project directory) on the first "
        "line, "
        "and starting from the next line the desired content without any quotes or other formatting. "
        "The tool will completely overwrite the entire file, so be very careful with it, "
        "avoid using it on non-empty files."
    )

    def __init__(self, wd: str = "."):
        self.workdir = wd

    def func(self, args: str) -> str:
        # Use a regular expression to extract the file path from the input
        if "\n" not in args:
            file_path = args.strip().strip("'").strip()
            content = ""
            with open(os.path.join(self.workdir, file_path), "w") as f:
                f.write(content)
                return "Created an empty file."
        file_path, content = args.split("\n", 1)
        file_path = file_path.strip().strip("'").strip()
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
                with open(os.path.join(self.workdir, args.strip()), "r") as f:
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
            line_ranges = line_range.split("]")[0].split(",")
            line_ranges = [line_range.split(":") for line_range in line_ranges]
            line_ranges = [
                (int(line_range[0].strip()) - 1, int(line_range[1].strip()))
                for line_range in line_ranges
            ]
            with open(os.path.join(self.workdir, filename.strip()), "r") as f:
                lines = f.readlines()
                out = ""
                for line_range in line_ranges:
                    out += "".join(
                        [
                            f"{i + 1}| {lines[i]}"
                            for i in range(line_range[0], line_range[1] + 1)
                        ]
                    )
                return "```\n" + out + "\n```"
        except Exception as e:
            return f"Error reading file: {str(e)}"


def apply_patch(patch_str: str, file_path: str) -> Tuple[str, int, int]:
    # Split the patch string into lines and remove the filename
    patch_lines = patch_str.strip().split("\n")  # [1:]
    with open(file_path.strip(), "r") as file:
        file_lines = file.readlines()

    plus_lines, minus_lines = 0, 0
    # Loop through the patch lines
    for patch_line in patch_lines:
        if "|" not in patch_line and patch_line.strip():
            raise ValueError(
                f"Invalid patch line: {patch_line}. Has to have the format +N|line or -N|line."
            )
        if not patch_line.strip():
            continue
        # Parse the patch line
        action, index, content = (
            patch_line[0],
            int(patch_line[1:].split("|")[0]) - 1,
            patch_line.split("|", 1)[1],
        )

        # Apply the patch line to the file content
        if action == "-" and 0 <= index < len(file_lines):
            del file_lines[index]
            minus_lines += 1
        elif action == "+" and 0 <= index <= len(file_lines) and content.strip():
            file_lines.insert(index, content + "\n")
            plus_lines += 1
    return "".join(file_lines), plus_lines, minus_lines


@dataclass
class PatchFile(SimpleTool):
    """
    A tool that can be used to patch files.
    """

    name = "PatchFile"
    description = (
        "a tool to patch a file: make amends to it using diffs. "
        "Provide the diff in unified format, and the tool will apply it to the specified file."
        "The first line of the action input is the filename, the rest is the diff. "
        "The diff (the lines with - will be deleted from the original file) looks like this:\n"
        "-36|# start poling\n"
        "+36|# start polling\n"
        "-37|    updater.start_polling()    updater.idle()\n"
        "+37|    updater.start_polling()\n"
        "+38|    updater.idle()\n"
        "Remember to add 'AResult:' after."
    )

    def __init__(self, wd: str = "."):
        self.workdir = wd

    def func(self, args: str) -> str:
        """
        Apply the given diff (in unified or context format) to the specified files in the working directory.
        The diff should be provided as a string in the args parameter.

        :param args: The diff to apply to the files.
        :return: The result of the patch command as a string.
        """
        if '\n' not in strip_quotes(args):
            return 'Error: no newline found in input. ' \
                   'The first line should be the filename, the rest should be the patch.'
        filename, patch = strip_quotes(args).split("\n", 1)
        patch = strip_quotes(patch)
        filename = os.path.join(self.workdir, filename.strip())
        try:
            new_content, plus_lines, minus_lines = apply_patch(patch, filename)
        except Exception as e:
            return f"Error applying patch: {str(e)}\n"
        with open(filename, "w") as file:
            file.write(new_content)
        return f"Successfully patched {filename} with {plus_lines} added lines and {minus_lines} removed lines."


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
            with open(os.path.join(self.workdir, args.strip()), "r") as f:
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
