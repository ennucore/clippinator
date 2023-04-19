from .tool import SimpleTool
from dataclasses import dataclass
import os
import subprocess


@dataclass
class FindUsages(SimpleTool):
    pass


@dataclass
class SearchAndReplace(SimpleTool):
    pass


@dataclass
class Pylint(SimpleTool):
    name = "Pylint"
    description = (
        "runs pylint to check for python errors. By default it runs on the entire project. "
        "You can specify a relative path to run on a specific file or module."
    )

    def __init__(self, wd: str = "."):
        self.workdir = wd

    def run_pylint_on_file(self, target: str) -> list[str]:
        cmd = ["pylint", target, "-E", "--output-format", "text"]
        process = subprocess.run(cmd, capture_output=True, text=True)
        pylint_output = process.stdout.strip().split("\n")
        return pylint_output

    def func(self, args: str) -> str:
        target = args.strip() if args.strip() else self.workdir
        target = os.path.join(self.workdir, target)

        pylint_output = []

        if os.path.isfile(target) and target.endswith(".py"):
            pylint_output = self.run_pylint_on_file(target)
        elif os.path.isdir(target):
            for root, _, files in os.walk(target):
                for file in files:
                    if file.endswith(".py"):
                        file_path = os.path.join(root, file)
                        pylint_output.extend(self.run_pylint_on_file(file_path))
        else:
            return f"Target not found: {target}"

        # Format the output for better readability
        formatted_output = "\n".join(pylint_output)

        return formatted_output


class SearchInFiles(SimpleTool):
    """
    A tool that can be used to search for a string in all files.
    """
    name = "SearchInFiles"
    description = "A tool that can be used to search for occurrences a string in all files. " \
                  "The input format is [search_directory] on the first line, " \
                  "and the search query on the second line. " \
                  "The tool will return the file paths and line numbers containing the search query."

    def __init__(self, wd: str = "."):
        self.workdir = wd

    def search_files(self, search_dir: str, search_query: str) -> list[str]:
        results = []
        search_dir = os.path.join(self.workdir, search_dir)

        for root, _, files in os.walk(search_dir):
            for file in files:
                file_path = os.path.join(root, file)

                try:
                    with open(file_path, 'r') as f:
                        lines = f.readlines()

                    for line_number, line in enumerate(lines, start=1):
                        if search_query.lower() in line.lower():
                            results.append(f"{file_path}:{line_number}")
                except Exception as e:
                    # Ignore errors related to file reading or encoding
                    pass

        return results

    def func(self, args: str) -> str:
        # Split the input by newline to separate the search directory and the search query
        input_lines = args.strip().split('\n')

        if len(input_lines) < 2:
            return "Invalid input. Please provide search directory on the " \
                   "first line and search query on the second line."

        search_dir = os.path.join(self.workdir, input_lines[0])
        search_query = input_lines[1]

        results = self.search_files(search_dir, search_query)

        if results:
            return "\n".join(results)
        else:
            return "No matches found."
