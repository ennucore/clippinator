from __future__ import annotations

import os
import subprocess

import yaml

from clippy.project import Project
from .tool import SimpleTool

with open('clippy/tools/templates.yaml') as f:
    data = yaml.load(f, Loader=yaml.FullLoader)
    templates = {line['name']: line for line in data}


class DeclareArchitecture(SimpleTool):
    name = "DeclareArchitecture"
    description = "declare the architecture of the project for the subagents"

    def __init__(self, project: Project):
        self.project = project
        super().__init__()

    def func(self, args: str) -> str:
        self.project.architecture = args
        return f"Architecture declared."


class Remember(SimpleTool):
    name = "Remember"
    description = "remember a fact for later use which will be known globally " \
                  "(e.g. some bugs, implementation details, something to be done later, etc.)"

    def __init__(self, project: Project):
        self.project = project
        super().__init__()

    def func(self, args: str) -> str:
        self.project.memories.append(args)
        self.project.memories = self.project.memories[-10:]
        return f"Remembered {args}."


class TemplateInfo(SimpleTool):
    name = "TemplateInfo"
    description = "get information about templates. Templates available: " + ', '.join(templates.keys()) + (
        ". Example input: Preact frontend, Fastapi"
    )

    @staticmethod
    def structured_func(template_names: list[str]):
        return '\n----\n'.join(templates[template_name]['info'] for template_name in template_names)

    def func(self, args: str):
        template_names = [template_name.strip() for template_name in args.split(',')]
        return self.structured_func(template_names)


def setup_template(template_name: str, path: str, project_name: str):
    template = templates[template_name]
    cmd = template['setup'].format(br='{}', project_name=project_name)
    cwd = os.path.realpath(os.path.join(path, '..'))
    print(cmd)
    completed_process = subprocess.run(
        cmd,
        shell=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        cwd=cwd,
        timeout=120,
    )
    stdout_output = completed_process.stdout.decode()
    print('Deployed template:', stdout_output)


class TemplateSetup(SimpleTool):
    name = "TemplateSetup"
    description = "set up a project or a subproject by a template. The first argument is the template name, " \
                  "then ;, then the path (. by default). If there's already " \
                  "something in the target directory, it will be overwritten. Example: Preact frontend; frontend"
    structured_desc = "set up a project or a subproject by a template. The first argument is the template name, " \
                      "the other is the path (. by default). If there's already something in the target directory, " \
                      'it will be overwritten. Example: {"template": "Preact frontend", "path": "frontend"'

    def __init__(self, project: Project):
        self.project = project
        super().__init__()

    def structured_func(self, template_name: str, path: str):
        if path.strip() in '.':
            parent_folder = os.path.realpath(os.path.join(self.project.path, '..'))
            project_name = os.path.basename(self.project.path)
            path_old = os.path.join(parent_folder, project_name + '_')
            os.rename(self.project.path, path_old)
            setup_template(template_name, parent_folder, project_name)
            return f"Set up {template_name} template, overwritten old content."
        path = os.path.join(self.project.path, path or '.')
        project_name = path.split('/')[-1]
        setup_template(template_name, path, project_name)
        return f"Set up {template_name} template in {path}."

    def func(self, args: str):
        args = args.split(';')
        template_name = args[0].strip()
        path = args[1].strip()
        return self.structured_func(template_name, path)
