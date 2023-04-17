import typer
from dotenv import load_dotenv


load_dotenv()

app = typer.Typer(help='Clippy is an AI coding assistant.')


@app.command()
def run(objective: str, project_path: str = '.'):
    """
    Run Clippy on the current project with a given objective.
    """
    pass


@app.command()
def new(objective: str, project_path: str = '.'):
    """
    Create a new project using clippy.
    """
    pass


if __name__ == "__main__":
    app()
