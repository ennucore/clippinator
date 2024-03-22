import { Environment, FileSystemTree } from './environment/environment';
import { callLLMFast } from './llm';
import { ToolCall, ToolCallsGroup } from './toolbox';
import { skip_paths, skip_ext } from './utils';
import { hashString, trimString } from './utils';

export function formatFileContent(lines: string[], line_threshold: number = 2000): string {
    let formattedLines;
    if (lines.length > line_threshold) {
        const startLines = lines.slice(0, line_threshold / 2);
        const endLines = lines.slice(-line_threshold / 2);
        formattedLines = [...startLines, '...', ...endLines];
    } else {
        formattedLines = lines;
    }

    const formattedContent = formattedLines.map((line, index) => `${index + 1}|${line}`).join('\n');
    return formattedContent;
}


const xmljs = require('xml-js');
export function formatObject(obj: any, format: "json" | "xml" = "xml"): string {
    if (format === "json") {
        return JSON.stringify(obj, null, 2);
    } else {
        return xmljs.js2xml(obj, { compact: true, spaces: 2 });
    }
}


const THRESHOLD = 300; // Define a threshold for the number of lines
const CAP_REDUCTION_PER_LEVEL = 10; // Symbol cap reduction per recursion level
const MIN_CAP = 500; // Minimum symbol cap

export class WorkspaceNode {
    path: string;
    content: string;
    children?: WorkspaceNode[];

    constructor(path: string, content: string, children?: WorkspaceNode[]) {
        this.path = path;
        this.content = content;
        this.children = children;
    }

    contentLength(): number {
        if (this.content && !this.children) {
            return this.content.length;
        }
        if (this.children) {
            return this.children.reduce((acc, child) => acc + child.contentLength(), 0);
        }
        return 0;
    }
}

function getFileContent(fileSystemTree: FileSystemTree, symbolCap: number): string {
    if (!fileSystemTree.isDirectory && fileSystemTree.content) {
        const fileContent = fileSystemTree.content.join('\n').slice(0, symbolCap);
        const lines = fileContent.split(/\r?\n/);
        const formattedContent = trimString(formatFileContent(lines, THRESHOLD), symbolCap);
        return formattedContent;
    }
    return '';
}

export function getWorkspaceStructure(fileSystemTree: FileSystemTree, symbolCap: number): WorkspaceNode {
    let currentCap = symbolCap;

    const readDirRecursive = (tree: FileSystemTree, cap: number): WorkspaceNode => {
        if (tree.isDirectory && tree.children) {
            const children: WorkspaceNode[] = [];
            for (const child of tree.children) {
                if (skip_paths.includes(child.path.split('/').pop() || '')) {
                    continue;
                }
                const nextCap = Math.max(cap / CAP_REDUCTION_PER_LEVEL, MIN_CAP);
                const childTree = readDirRecursive(child, nextCap);
                children.push(childTree);
                cap -= childTree.contentLength() || 0;

                // const fileContent = getFileContent(child, cap);
                // children.push(new WorkspaceNode(child.path, fileContent, []));

                cap = Math.max(cap, MIN_CAP);
            }
            return new WorkspaceNode(tree.path, "", children);
        } else {
            if ((!skip_ext.includes(tree.path.split('.').pop() || '')) && symbolCap > MIN_CAP && currentCap > MIN_CAP) {
                const fileContent = getFileContent(tree, cap);
                return new WorkspaceNode(tree.path, fileContent, []);
            }
            return new WorkspaceNode(tree.path, "", []);
        }
    };

    const rootTree = readDirRecursive(fileSystemTree, currentCap);
    return rootTree;
}

export async function buildSmartWorkspaceStructure(fileSystemTree: FileSystemTree, objective: string = ""): Promise<string> {
    if (!fileSystemTree.isDirectory) {
        if (fileSystemTree.content && fileSystemTree.content!.length > 5000) {
            let fileContent = formatFileContent(fileSystemTree.content!, 50000);
            let fileContentSummarized = await callLLMFast(`We are working in a workspace with a lot of files.
Overall, we are pursuing this objective:
<objective>${objective}</objective>
Here is a file with the path ${fileSystemTree.path} and its content:
${fileContent}
Please, provide the main lines of this file with some comments. Respond only with the lines. Make it in a format similar to the original, with all the important classes and functions included with their description.
If the content is relevant to the objective, make it especially detailed.
For example, write something like this:
40|class MyClass: # handling the logic for ...
50| def my_function55|class AnotherClass: # ...
Do not respond with any lines that are not in the format above.
`);
            return `<file>
<path>${fileSystemTree.path}</path>
<content>
${fileContentSummarized}
</content>
</file>`;
        } else {
            return `<file>
<path>${fileSystemTree.path}</path>
<content>
${formatFileContent(fileSystemTree.content || [])}</content>
</file>`;
        }
    } else {
        let xml = `<directory>
<path>${fileSystemTree.path}</path>
<children>
  `;
        if (!fileSystemTree.children) {
            xml += `</children>
</directory>`;
            return xml;
        }
        let childrenContent = [];
        let n = 7;
        for (let i = 0; i < fileSystemTree.children.length; i += n) {
            const children = fileSystemTree.children.slice(i, i + n);
            const promises = children.map(child => buildSmartWorkspaceStructure(child, objective));
            const results = await Promise.allSettled(promises);
            for (const result of results) {
                if (result.status === 'fulfilled') {
                    childrenContent.push(result.value);
                }
            }
        }
        xml += childrenContent.join('\n');
        xml += `
</children>
</directory>`;
        if (xml.length > 10000) {
            xml = await callLLMFast(`I need you to help prettify a workspace structure.
<example>
<ws-structure>
<directory>
<path>myapp</path>
<children>
  <file>
<path>myapp/app.py</path>
<content>
1|from flask import Flask
2|from flask_sqlalchemy import SQLAlchemy
3|from myapp.routes import main
4|
5|app = Flask(__name__)
6|app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///myapp.db'
7|db = SQLAlchemy(app)
8|
9|app.register_blueprint(main)
10|
11|if __name__ == '__main__':
12|    app.run(debug=True)
</content>
</file>
<file>
<path>myapp/models.py</path>
<content>
1|from myapp.app import db
2|
3|class User(db.Model):
4|    id = db.Column(db.Integer, primary_key=True)
5|    username = db.Column(db.String(80), unique=True, nullable=False)
6|    email = db.Column(db.String(120), unique=True, nullable=False)
7|
8|    def __repr__(self):
9|        return f'<User {self.username}>'
</content>
</file>
<directory>
<path>myapp/templates</path>
<listing>
index.html
layout.html
login.html 
</listing>
<description>HTML templates for rendering pages</description>
</directory>
<directory>
<path>myapp/routes</path>
<children>
  <file>
<path>myapp/routes/main.py</path>
<content>
1|from flask import Blueprint, render_template
2|
3|main = Blueprint('main', __name__)
4|
5|@main.route('/')
6|def index():
7|    return render_template('index.html')
</content>
</file>
<file>
<path>myapp/routes/auth.py</path>
<content>
1|from flask import Blueprint
2|
3|auth = Blueprint('auth', __name__)
4|
5|@auth.route('/login')
6|def login():
7|    return 'Login'
</content>  
</file>
</children>
</directory>
</children>
</directory>
</ws-structure>

Output:
<ws-structure>
<directory>
<path>myapp</path>
<children>
<file>
<path>myapp/app.py</path>
<content>
5|app = Flask(__name__)
6|app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///myapp.db' 
7|db = SQLAlchemy(app)
9|app.register_blueprint(main)
</content>
</file>
<file>
<path>myapp/models.py</path>
<content>
3|class User(db.Model):
4|    id = db.Column(db.Integer, primary_key=True)
5|    username = db.Column(db.String(80), unique=True, nullable=False)
6|    email = db.Column(db.String(120), unique=True, nullable=False)
</content>
</file>
<directory>
<path>myapp/templates</path>
<description>HTML templates for rendering pages</description>
</directory>
<directory>
<path>myapp/routes</path>
<children>
<file>
<path>myapp/routes/main.py</path>
<content>
3|main = Blueprint('main', __name__)
5|@main.route('/')
6|def index():   # Returns index.html
</content>
</file>
<file>
<path>myapp/routes/auth.py</path>
<content>
3|auth = Blueprint('auth', __name__)
5|@auth.route('/login') 
6|def login():   # Returns 'Login'
</content>
</file>
</children>  
</directory>
</children>
</directory>
</ws-structure>

Example 2:

Input:
<objective>Understand the structure and key elements of a Python package with tests</objective>

<ws-structure>
<directory>
<path>mypackage</path>
<children>
<file>
<path>mypackage/__init__.py</path>
<content>
1|from .mymodule import MyClass
</content>
</file>
<file>
<path>mypackage/mymodule.py</path>  
<content>
1|class MyClass:
2|    def __init__(self, value):
3|        self.value = value
4|
5|    def get_value(self):
6|        return self.value
7|
8|    def set_value(self, value):
9|        self.value = value
</content>
</file>
<directory>
<path>tests</path>
<children>
<file>
<path>tests/test_mymodule.py</path>
<content>  
1|import unittest
2|from mypackage.mymodule import MyClass
3|
4|class TestMyClass(unittest.TestCase):
5|    def test_initial_value(self):
6|        obj = MyClass(42)
7|        self.assertEqual(obj.get_value(), 42)
8|
9|    def test_set_value(self):
10|        obj = MyClass(0)
11|        obj.set_value(99)
12|        self.assertEqual(obj.get_value(), 99)
13|
14|if __name__ == '__main__':
15|    unittest.main()
</content>
</file>
</children>
</directory>
<file>
<path>setup.py</path>
<content>
1|from setuptools import setup, find_packages
2|
3|setup(
4|    name='mypackage',
5|    version='1.0',
6|    packages=find_packages(),
7|)  
</content>
</file>
</children>
</directory>
</ws-structure>

Output:
<ws-structure>
<directory>
<path>mypackage</path>
<children>
<file>
<path>mypackage/__init__.py</path>
<content>
1|from .mymodule import MyClass  
</content>
</file>
<file>
<path>mypackage/mymodule.py</path>
<content>
1|class MyClass:    # class for storing the value attribute
5|    def get_value(self):
8|    def set_value(self, value):
</content>
</file>  
<directory>
<path>tests</path>
<children>
<file>
<path>tests/test_mymodule.py</path>
<content>
4|class TestMyClass(unittest.TestCase):
5|    def test_initial_value(self):    # test that the value is correct after initialization
9|    def test_set_value(self):    # test that the value is set correctly
</content>
</file>
</children>
</directory>
<file>
<path>setup.py</path>
<content>
</content>  
</file>
</children>
</directory>  
</ws-structure>
</example>
We are working in a workspace with a lot of files.
Overall, we are pursuing this objective:
<objective>${objective}</objective>
Here is the structure of a folder with the path ${fileSystemTree.path}:
<ws-structure>
${xml}
</ws-structure>
Please, provide a smart XML structure for this folder, wrapped in the <ws-structure> tag. Respond only with the XML in the format like above. Each file should be represented as <file><path>...</path><content>...</content></file>, and each directory as <directory><path>...</path><children>...</children></directory>. Include only the most important lines (usually classes and functions definitions) in the content.
For some files, you can skip their content and just write their path. If something is relevant to the objective, include it in more detail.
For some directories, if the files are not important, you can do this:
<directory>
<path>...</path>
<listing>
file1
file2
</listing>
<description>A few words about the content of the files</description>
</directory>
There is no need to include e.g. .gitignore contents or some other unimportant stuff like that. You can skip all the useless bullshit.
Do not respond with anything other than the resulting XML. If you say something like "Here is the XML" or "Ok", it will be a great mistake.
Make sure to have correct XML syntax.
  `, undefined, "</ws-structure>", true, "<ws-structure>");
            // remove the ws-structure tag
            xml = xml.replace(/<\/?ws-structure>/g, '');
        }
        return xml;
    }
}

export interface Message {
    type: "thoughts" | "user" | "system";
    content: string;
}

export class ContextManager {
    todos: string[];
    memory: string;
    history: (ToolCallsGroup | Message)[];
    objective: string;
    lastFileSystemHash: string;
    lastWorkspaceSummary: string;
    lastLinterOutput: string;

    constructor(objective: string = "") {
        this.todos = [];
        this.memory = "";
        this.history = [];
        this.objective = objective;
        this.lastFileSystemHash = "";
        this.lastWorkspaceSummary = "";
        this.lastLinterOutput = "";
    }

    getFirstTodo(): string | undefined {
        /* Get the first one that isn't marked by "- [x]" and remove "- [ ]" */
        for (const todo of this.todos) {
            if (!todo.startsWith("- [x]")) {
                return todo.replace("- [ ]", "");
            }
        }
    }

    async getLinterOutput(env: Environment): Promise<string> {
        let output = await env.getLinterOutput();
        this.lastLinterOutput = output;
        return output;
    }

    async getWorkspaceStructure(env: Environment): Promise<string> {
        const workspace = getWorkspaceStructure(await env.getFileSystem(), 30000);
        let fs_str = formatObject(workspace);
        let term_state = await env.getTerminalState();
        let term_str = '';
        if (term_state.length > 0 && term_state[0].history.length > 0) {
            term_str = '**Terminal state:**\n';
            term_state.forEach((tab, index) => {
                term_str += `Tab ${index}:\n${tab.history.join('\n')}\n`;
            });
        }
        let linter_output = this.lastLinterOutput;
        if (!linter_output) {
            linter_output = await this.getLinterOutput(env);
        }
        return `${fs_str}\n${term_str}\nLinter output:\n${linter_output}`;
    }

    async getWorkspaceStructureSummary(env: Environment): Promise<string> {
        const fullStructure = await this.getWorkspaceStructure(env);
        const hash = hashString(fullStructure);
        if (hash === this.lastFileSystemHash && this.lastWorkspaceSummary) {
            return this.lastWorkspaceSummary;
        }
        this.lastFileSystemHash = hash;
        //         this.lastWorkspaceSummary = await callLLMFast(`We are working in a workspace with some files and terminals. We have the following objective:
        // <objective>${this.objective}</objective>
        // Please, provide a summary of the following workspace structure. 
        // It should be in a very similar format to the one you see below, but with a lot less details. 
        // It should contain all the files and directories and an outline of the meaning of each file, the main classes and functions etc it contains (same with the terminal tabs if they are there). Reply ONLY with the summary, in a similar format to the original structure. 
        // In the summary, you have to includ **all** the paths exactly the same as in the original, and the content should be in the same form as the original content although you can omit some lines. However, do include all the important lines with important classes and functions etc. in the format \`n|class ClassName:\' with some descriptions. If some file is tangentially related to the overall objective, include its content **fully**.
        // Here is the workspace:\n\`\`\`\n${fullStructure}\n\`\`\`
        // Now, based on that, provide your edit. IT HAS TO BE ALMOST THE SAME LENGTH AS THE ORIGINAL, SAME FORMAT, AND VERY SIMILAR IN MANY WAYS. INCLUDE IMPORTANT OR RELEVANT LINES FROM EACH FILE
        // `);
        this.lastWorkspaceSummary = await buildSmartWorkspaceStructure(await env.getFileSystem(), this.objective);
        console.log("\n\n\nWorkspace Summary:\n", this.lastWorkspaceSummary)
        return this.lastWorkspaceSummary;
    }

    async getContext(env: Environment, is_full: boolean = true): Promise<string> {
        const todos = this.todos.join('\n');
        const memory = this.memory;
        let actionHistory = '<history>\n';
        for (const action of this.history) {
            if ("type" in action) {
                actionHistory += `<${action.type}>${action.content}</${action.type}>\n`;
            } else {
                actionHistory += '<function_calls>\n';
                for (const toolCall of action) {
                    actionHistory += '<invoke>\n' + trimString(formatObject({ tool_name: toolCall.tool_name, parameters: toolCall.parameters }, "xml"), 5000) + '\n</invoke>\n';
                }
                actionHistory += '</function_calls>\n';
                actionHistory += '<function_results>\n';
                for (const toolCall of action) {
                    actionHistory += '<result>\n';
                    actionHistory += '<tool_name>' + toolCall.tool_name + '</tool_name>\n';
                    actionHistory += '<stdout>\n' + trimString(toolCall.result || "", 10000) + '\n</stdout>\n';
                    actionHistory += '</result>\n';
                }
                actionHistory += '</function_results>\n';
            }
        }
        actionHistory += '</history>';
        let workspace = await this.getWorkspaceStructureSummary(env);
        const context = `\nMemory:\n${memory}\nWorkspace:\n${workspace}\n\nThe user's request (the overall objective):\n${this.objective}\nThe plan:\n${todos}\n\n\n${actionHistory}\n\n`;
        return context;
    }
}
