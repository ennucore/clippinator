from __future__ import annotations

import os
import subprocess

import yaml

from clippinator.project import Project
from .tool import SimpleTool

with open('clippinator/tools/templates.yaml') as f:
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
    description = "get information about templates. Templates available:\n" + \
                  '\n'.join('  - ' + k for k in templates.keys()) + \
                  "\n\nExample action input: Preact frontend, Fastapi"

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
        timeout=180,
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
                      'it will be overwritten. Example: {"template": "Preact frontend", "path": "frontend"}'

    def __init__(self, project: Project):
        self.project = project
        super().__init__()

    def structured_func(self, template_name: str, path: str):
        assert template_name in templates, f"Template {template_name} not found."
        if path.strip() in '.':
            parent_folder = os.path.realpath(os.path.join(self.project.path, '..'))
            project_name = os.path.basename(self.project.path)
            path_old = os.path.join(parent_folder, project_name + '_')
            if os.path.exists(path_old):
                os.system(f"rm -rf '{path_old}'")
            subprocess.run(['mv', self.project.path, path_old]).check_returncode()
            setup_template(template_name, self.project.path, project_name)
            template = templates[template_name]
            self.project.template = template_name
            if template.get('ci'):
                ci = template['ci']
                if ci.get('run'):
                    self.project.memories.append(f"The command to run the project: `{ci.get('run')}`")
                self.project.ci_commands = ci
            if template.get('memories'):
                self.project.memories.extend(template['memories'])
            return f"Set up {template_name} template, overwrote old content."
        path = os.path.join(self.project.path, path or '.')
        project_name = path.split('/')[-1]
        setup_template(template_name, path, project_name)
        return f"Set up {template_name} template in {path}."

    def func(self, args: str):
        args = args.split(';')
        template_name = args[0].strip()
        path = args[1].strip()
        return self.structured_func(template_name, path)


class SetCI(SimpleTool):
    name = "SetCI"
    description = "Configure the commands to run, lint, test the project or lint a file " \
                  "(`{command} {file}` will be used). " \
                  'Input format: `lint: "command", lintfile: "command", test: "command", run: "command"`'
    structured_desc = "Configure the commands to run, lint, test the project or lint a file. "

    def __init__(self, project: Project):
        self.project = project
        super().__init__()

    def structured_func(self, lint: str = '', lintfile: str = '', test: str = '', run: str = '', **kwargs):
        self.project.ci_commands = {
            'lint': lint,
            'lintfile': lintfile,
            'test': test,
            'run': run,
            **kwargs,
        }
        if run:
            self.project.memories.append(f"The command to run the project: `{run}`")
        if test:
            self.project.memories.append(f"The command to test the project: `{test}`")
        return f"CI set up."

    def func(self, args: str):
        args = args.strip().strip('`').split('", ')
        args = {arg.split(':')[0].strip(): arg.split(':')[1].strip().removeprefix('"').removesuffix('"')
                for arg in args}
        return self.structured_func(**args)
