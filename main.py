import typer
from dotenv import load_dotenv
from clippy.clippy import Clippy
import os


load_dotenv()

app = typer.Typer(help='Clippy is an AI coding assistant.')


@app.command()
def run(objective: str, project_path: str = '.'):
    """
    Run Clippy on the current project with a given objective.
    """
    clippy = Clippy.create(project_path, objective)
    clippy.run()


@app.command()
def new(objective: str, project_path: str = '.'):
    """
    Create a new project using clippy.
    """
    os.makedirs(project_path, exist_ok=True)
    clippy = Clippy.create(project_path, objective)
    clippy.run()


if __name__ == "__main__":
    app()
