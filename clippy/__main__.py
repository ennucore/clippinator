import os

import rich
import typer
from dotenv import load_dotenv

from clippy.minions.taskmaster import Taskmaster
from clippy.project import Project
from clippy.tools.utils import text_prompt

load_dotenv()

app = typer.Typer(help="Clippy is an AI coding assistant.")


@app.command()
def taskmaster(project_path: str, objective: str = ""):
    """
    Create a new project using clippy.
    """
    try:
        if not objective and not os.path.exists(
                os.path.join(project_path, ".clippy.pkl")
        ):
            objective = text_prompt("What project do I need to create?\n")
        if not objective and os.path.exists(os.path.join(project_path, ".clippy.pkl")):
            print(os.path.join(project_path, ".clippy.pkl"))
            tm = Taskmaster.load_from_file(os.path.join(project_path, ".clippy.pkl"))
            tm.run(**tm.project.prompt_fields(tm.length_norm))
            return
        elif os.path.exists(os.path.join(project_path, ".clippy.pkl")):
            tm = Taskmaster.load_from_file(os.path.join(project_path, ".clippy.pkl"))
            project = tm.project
            project.objective = objective
            tm = Taskmaster(project)
            tm.run(**project.prompt_fields(tm.length_norm))
            return
        os.makedirs(project_path, exist_ok=True)
        project = Project(project_path, objective)
        tm = Taskmaster(project)
        tm.run(**project.prompt_fields(tm.length_norm))
    except KeyboardInterrupt:
        print("Interrupted. Agent is stopped.")


if __name__ == "__main__":
    if not os.environ.get('OPENAI_API_KEY'):
        rich.print("[bold red]OPENAI_API_KEY is not set.[/bold red] You can set it permanently in .env file.")
        os.environ['OPENAI_API_KEY'] = text_prompt("Please, enter your OpenAI API key")
    app()
