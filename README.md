![](clippy.jpg)
# Clippy
_A code assistant_

### Getting started

1. Install [Poetry](https://python-poetry.org/docs/#installation).
2. Clone this repository.
3. Add api keys (OpenAI, Wolfram) to `.env` file.
4. Install `ctags`.
5. For pylint, install it and [pylint-venv](https://github.com/jgosmann/pylint-venv/).
6. Install dependencies: `poetry install`.
7. Run: `poetry run python main.py --help`. To create a new project, use `poetry run python main.py new PROJECT_PATH`

### Details

This tool has a planning agent which creates a plan with milestones and tasks.
Then, it calls the execution agent. 
It also has a shared context for important information and a bunch of tools.

This is based on GPT-4 which runs for a long time, so it's quite expensive in terms of OpenAI API.
