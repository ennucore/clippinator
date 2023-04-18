import re
import os
import subprocess
import difflib
from dataclasses import dataclass
from langchain.agents import Tool
import patch
from clippy.tools.tool import Toolkit, SimpleTool


@dataclass
class WriteFile(SimpleTool):
    """
    A tool that can be used to write files.
    """
    name = "WriteFile"
    description = "A tool that can be used to write files. " \
                  "The input format is [dir/filename.ext], and starting from the next line the desired content. " \
                  "The tool will overwrite the entire file."

    def __init__(self, wd: str = '.'):
        self.workdir = wd

    def func(self, args: str) -> str:
        # Use a regular expression to extract the file path from the input
        match = re.match(r'\[(.+)\]', args)
        if not match:
            return "Invalid input. Please provide the file path in brackets."

        file_path = match.group(1)
        original_file_path = file_path
        file_path = os.path.join(self.workdir, file_path)

        # Split the input by newline and remove the first line (the file path)
        input_lines = args.strip().split('\n')[1:]

        # Join the remaining lines to form the content
        content = '\n'.join(input_lines)

        try:
            # Check if the directory exists, if not create it
            directory = os.path.dirname(file_path)
            if not os.path.exists(directory):
                os.makedirs(directory)

            # Write the content to the file
            with open(file_path, 'w') as f:
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
    description = "A tool that can be used to read files. The input is just the file path."

    def __init__(self, wd: str = '.'):
        self.workdir = wd

    def func(self, args: str) -> str:
        try:
            with open(os.path.join(self.workdir, args.strip()), 'r') as f:
                return f.read()
        except Exception as e:
            return f"Error reading file: {str(e)}"


@dataclass
class PatchFile(SimpleTool):
    """
    A tool that can be used to patch files.
    """
    name = "PatchFile"
    description = "A tool to patch files using the Linux patch command. " \
                  "Provide the diff in unified or context format, and the tool will apply it to the specified files."

    def __init__(self, wd: str = '.'):
        self.workdir = wd

    def func(self, args: str) -> str:
        """
        Apply the given diff (in unified or context format) to the specified files in the working directory.
        The diff should be provided as a string in the args parameter.

        :param args: The diff to apply to the files.
        :return: The result of the patch command as a string.
        """
        with open(os.path.join(self.workdir, 'temp_diff.patch'), 'w') as diff_file:
            diff_file.write(args)

        command = ['patch', '-p1', '-i', 'temp_diff.patch']
        try:
            result = subprocess.run(command, cwd=self.workdir, capture_output=True, text=True, check=True)
            return result.stdout
        except subprocess.CalledProcessError as e:
            return e.stderr
        finally:
            os.remove(os.path.join(self.workdir, 'temp_diff.patch'))

@dataclass
class FileTools(Toolkit):
    """
    A tool that can be used to read and write files.
    """

    def __init__(self, wd: str = '.'):
        super().__init__(
            name="file tools",
            tools=[
                WriteFile(wd).get_tool(),
                ReadFile(wd).get_tool(),
                PatchFile(wd).get_tool()
            ]
        )

