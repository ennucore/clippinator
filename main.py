import os

import typer
from dotenv import load_dotenv

from clippy.clippy import Clippy
from clippy.minions.taskmaster import Taskmaster
from clippy.project import Project

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


@app.command()
def taskmaster(project_path: str, objective: str = ''):
    """
    Create a new project using clippy.
    """
    if not objective and not os.path.exists(os.path.join(project_path, '.clippy.pkl')):
        objective = typer.prompt('What project do I need to create?\n')
    if not objective and os.path.exists(os.path.join(project_path, '.clippy.pkl')):
        tm = Taskmaster.load_from_file(os.path.join(project_path, '.clippy.pkl'))
        tm.run(**tm.project.prompt_fields())
        return
    elif os.path.exists(os.path.join(project_path, '.clippy.pkl')):
        tm = Taskmaster.load_from_file(os.path.join(project_path, '.clippy.pkl'))
        project = tm.project
        project.objective = objective
        tm = Taskmaster(project)
        tm.run(**project.prompt_fields())
        return
    os.makedirs(project_path, exist_ok=True)
    project = Project(project_path, objective)
    tm = Taskmaster(project)
    tm.run(**project.prompt_fields())


if __name__ == "__main__":
    app()
