import os
import re
import subprocess
from dataclasses import dataclass
from clippy.tools.tool import SimpleTool
from langchain import OpenAI
from langchain.chains.summarize import load_summarize_chain
from langchain.chains.combine_documents.base import BaseCombineDocumentsChain
from langchain.docstore.document import Document
from langchain.text_splitter import CharacterTextSplitter


@dataclass
class WriteFile(SimpleTool):
    """
    A tool that can be used to write files.
    """

    name = "WriteFile"
    description = (
        "A tool that can be used to write files. "
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
        file_path, content = args.split("\n", 1)
        file_path = file_path.strip().strip("'").strip()

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
        "A tool that can be used to read files. The input is just the file path. "
        "Optionally, you can add [l1:l2] to the end of the file path to specify a range of lines to read."
    )

    def __init__(self, wd: str = "."):
        self.workdir = wd

    def func(self, args: str) -> str:
        try:
            if "[" not in args:
                with open(os.path.join(self.workdir, args.strip()), "r") as f:
                    lines = f.readlines()
                    lines = [f"{i + 1}. {line}" for i, line in enumerate(lines)]
                    return "".join(lines)
            filename, line_range = args.split("[", 1)
            line_ranges = line_range.strip("]").split(",")
            line_ranges = [line_range.split(":") for line_range in line_ranges]
            line_ranges = [
                (int(line_range[0]), int(line_range[1])) for line_range in line_ranges
            ]
            with open(os.path.join(self.workdir, filename.strip()), "r") as f:
                lines = f.readlines()
                out = ""
                for line_range in line_ranges:
                    out += "".join(
                        [
                            f"{i + 1}. {lines[i]}"
                            for i in range(line_range[0], line_range[1] + 1)
                        ]
                    )
                return out
        except Exception as e:
            return f"Error reading file: {str(e)}"


def update_line_counts(diff_input):
    hunks = re.split(r"(@@.*?@@)", diff_input)
    new_diff = []

    for i in range(len(hunks)):
        if i % 2 == 0:
            new_diff.append(hunks[i])
        else:
            hunk_header = hunks[i]
            hunk_body = hunks[i + 1]

            # Calculate new line counts
            old_lines = len(
                [
                    line
                    for line in hunk_body.split("\n")
                    if line.startswith("-") or line.startswith(" ")
                ]
            )
            new_lines = len(
                [
                    line
                    for line in hunk_body.split("\n")
                    if line.startswith("+") or line.startswith(" ")
                ]
            )

            # Update hunk header with new line counts
            hunk_header_parts = re.match(r"@@ -(\d+),\d+ \+(\d+),\d+ @@", hunk_header)
            old_start = hunk_header_parts.group(1)
            new_start = hunk_header_parts.group(2)

            new_hunk_header = f"@@ -{old_start},{old_lines} +{new_start},{new_lines} @@"
            new_diff.append(new_hunk_header)

    return "".join(new_diff)


@dataclass
class PatchFile(SimpleTool):
    """
    A tool that can be used to patch files.
    """

    name = "PatchFile"
    description = (
        "A tool to patch files using the Linux patch command. "
        "Provide the diff in unified format, and the tool will apply it to the specified files."
        "The entire diff must be provided as the action input, you must not create a separate file."
        "Don't forget about hunk headers in the format @@ -start_old,count_old +start_new,count_new @@"
        "These numbers are important, don't mess them up"
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
        args = update_line_counts(args.strip("'''").strip("```"))
        with open(os.path.join(self.workdir, "temp_diff.patch"), "w") as diff_file:
            diff_file.write(args)

        command = [
            "/bin/bash",
            "-c",
            "git apply temp_diff.patch --ignore-whitespace --inaccurate-eof",
        ]
        try:
            result = subprocess.run(
                command, cwd=self.workdir, capture_output=True, text=True, check=True
            )
            return result.stdout + result.stderr
        except subprocess.CalledProcessError as e:
            return e.stderr
        finally:
            os.remove(os.path.join(self.workdir, "temp_diff.patch"))


@dataclass
class SummarizeFile(SimpleTool):
    """
    A tool that can be used to summarize files.
    """

    name = "SummarizeFile"
    description = (
        "A tool that can be used to summarize files. The input is just the file path."
    )
    summary_agent: BaseCombineDocumentsChain
    text_splitter: CharacterTextSplitter

    def __init__(self, wd: str = ".", model_name: str = "gpt-3.5-turbo"):
        self.workdir = wd
        self.summary_agent = load_summarize_chain(
            OpenAI(temperature=0, model_name=model_name), chain_type="map_reduce"
        )
        self.text_splitter = CharacterTextSplitter()

    def func(self, args: str) -> str:
        try:
            with open(os.path.join(self.workdir, args.strip()), "r") as f:
                texts = self.text_splitter.split_text(f.read())
                docs = [Document(page_content=t) for t in texts]
                return self.summary_agent.run(docs)
        except Exception as e:
            return f"Error reading file: {str(e)}"
