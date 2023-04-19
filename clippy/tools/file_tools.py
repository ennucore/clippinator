import re
import os
import subprocess
from dataclasses import dataclass
from clippy.tools.tool import SimpleTool


@dataclass
class WriteFile(SimpleTool):
    """
    A tool that can be used to write files.
    """
    name = "WriteFile"
    description = "A tool that can be used to write files. " \
                  "The input format is 'dir/filename' (the path is relative to the project directory) on the first " \
                  "line, " \
                  "and starting from the next line the desired content. " \
                  "The tool will completely overwrite the entire file."

    def __init__(self, wd: str = '.'):
        self.workdir = wd

    def func(self, args: str) -> str:
        # Use a regular expression to extract the file path from the input
        file_path, content = args.split('\n', 1)
        file_path = file_path.strip().strip("'").strip()

        original_file_path = file_path
        file_path = os.path.join(self.workdir, file_path)

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
    description = "A tool that can be used to read files. The input is just the file path. " \
                  "Optionally, you can add [l1:l2] to the end of the file path to specify a range of lines to read."

    def __init__(self, wd: str = '.'):
        self.workdir = wd

    def func(self, args: str) -> str:
        try:
            if '[' not in args:
                with open(os.path.join(self.workdir, args.strip()), 'r') as f:
                    lines = f.readlines()
                    lines = [f'{i + 1}. {line}' for i, line in enumerate(lines)]
                    return ''.join(lines)
            filename, line_range = args.split('[', 1)
            line_ranges = line_range.strip(']').split(',')
            line_ranges = [line_range.split(':') for line_range in line_ranges]
            line_ranges = [(int(line_range[0]), int(line_range[1])) for line_range in line_ranges]
            with open(os.path.join(self.workdir, args.strip()), 'r') as f:
                lines = f.readlines()
                out = ''
                for line_range in line_ranges:
                    out += ''.join([f'{i + 1}. {lines[i]}' for i in range(line_range[0], line_range[1] + 1)])
                return out
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

        print(os.path.join(self.workdir, 'temp_diff.patch'))
        print(args)
        command = ['/bin/bash', '-c', 'patch -l -i temp_diff.patch']
        try:
            result = subprocess.run(command, cwd=self.workdir, capture_output=True, text=True, check=True)
            return result.stdout
        except subprocess.CalledProcessError as e:
            return e.stderr
        finally:
            os.remove(os.path.join(self.workdir, 'temp_diff.patch'))
