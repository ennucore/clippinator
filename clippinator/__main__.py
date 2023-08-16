import os

import rich
import typer
from dotenv import load_dotenv

from clippinator.minions.taskmaster import Taskmaster
from clippinator.project import Project
from clippinator.tools.utils import text_prompt

load_dotenv()

app = typer.Typer(help="Clippy is an AI coding assistant.")


@app.command()
def taskmaster(project_path: str, objective: str = ""):
    """
    Create a new project using clippinator.
    """
    try:
        if not objective and not os.path.exists(
                os.path.join(project_path, ".clippinator.pkl")
        ):
            objective = text_prompt("What project do I need to create?\n")
        if not objective and os.path.exists(os.path.join(project_path, ".clippinator.pkl")):
            print(os.path.join(project_path, ".clippinator.pkl"))
            tm = Taskmaster.load_from_file(os.path.join(project_path, ".clippinator.pkl"))
            tm.run(**tm.project.prompt_fields())
            return
        elif os.path.exists(os.path.join(project_path, ".clippinator.pkl")):
            tm = Taskmaster.load_from_file(os.path.join(project_path, ".clippinator.pkl"))
            project = tm.project
            project.objective = objective
            tm = Taskmaster(project)
            tm.run(**project.prompt_fields())
            return
        os.makedirs(project_path, exist_ok=True)
        project = Project(project_path, objective)
        tm = Taskmaster(project)
        tm.run(**project.prompt_fields())
    except KeyboardInterrupt:
        print("Interrupted. Agent is stopped.")


if __name__ == "__main__":
    if not os.environ.get('OPENAI_API_KEY'):
        rich.print("[bold red]OPENAI_API_KEY is not set.[/bold red] You can set it permanently in .env file.")
        os.environ['OPENAI_API_KEY'] = text_prompt("Please, enter your OpenAI API key")
    app()
