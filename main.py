import typer
from dotenv import load_dotenv
from clippy.clippy import Clippy
import os


load_dotenv()

app = typer.Typer(help='Clippy is an AI coding assistant.')


@app.command()
def run(objective: str = '', project_path: str = '.'):
    """
    Run Clippy on the current project with a given objective.
    """
    if not objective:
        objective = typer.prompt('What do I need to do?')
    clippy = Clippy.create(project_path, objective)
    clippy.run()


@app.command()
def new(project_path: str, objective: str = ''):
    """
    Create a new project using clippy.
    """
    if not objective:
        objective = typer.prompt('What project do I need to create?\n')
    os.makedirs(project_path, exist_ok=True)
    clippy = Clippy.create(project_path, objective)
    clippy.run()


@app.command()
def resume(clippy_path: str):
    """
    Continue working on a project.
    """
    clippy = Clippy.load_from_file(clippy_path)
    clippy.run()


if __name__ == "__main__":
    app()
