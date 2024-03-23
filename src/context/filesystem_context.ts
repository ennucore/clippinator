import { FileSystemTree } from '../environment/environment';
import { callLLMFast, callOpenAIStructured } from '../llm';
import { skip_paths, skip_ext } from '../utils';
import { trimString } from '../utils';
import { formatFileContent } from '../utils';
import { getFileSummary } from './ctags';

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

interface File {
    path: string;
    content: string;
}

interface Directory {
    path: string;
    children: (File | Directory)[];
    summary: string;
}

export async function simplifyTree(tree: FileSystemTree, symbolCap: number, exec: (cmd: string) => Promise<string>): Promise<Directory | File> {
    const estimateLenght = (tree: Directory): number => {
        let length = tree.path.length;
        for (const child of tree.children) {
            if ('content' in child) {
                length += child.content.length + child.path.length;
            } else {
                length += estimateLenght(child);
            }
        }
        return length;
    }
    // handle skip_ext, skip_paths
    if (skip_paths.includes(tree.path.split('/').pop() || '')) return {path: tree.path, children: [], summary: ''};
    if ((skip_ext.concat(['sql', 'yml'])).includes(tree.path.split('.').pop() || '')) return {path: tree.path, content: ""};
    if (!tree.isDirectory && tree.content) {
        let content = "";
        if (['py', 'js', 'ts', 'cpp', 'rs', 'go', 'md'].includes(tree.path.split('.').pop() || '')) {
            content = await getFileSummary(tree.path, tree.content!, "", 120, 120, exec)
        }
        return {content, path: tree.path};
    }
    const children = tree.children || [];
    
    // if there are too many files
    if (children.filter(child => !child.isDirectory).length > 25 && tree.path !== '') {
        // it's a junk directory, we just give a summary
        let summary = await callLLMFast(`Give a one-line summary of the directory ${tree.path}. Here is a list of its children:\n${children.map(child => child.path).join('\n')}`);
        return {path: tree.path, children: [], summary};
    }
    // const childNodes = await Promise.all(children.map(child => simplifyTree(child, symbolCap, exec)));
    let childNodes: (File | Directory)[] = [];
    for (const child of children) {
        const childNode = await simplifyTree(child, symbolCap / 2, exec);
        childNodes.push(childNode);
    }
    let res = {path: tree.path, children: childNodes, summary: ''};
    if (estimateLenght(res) > symbolCap) {
        let summary = await callLLMFast(
            `Give a shorter description of the directory ${tree.path}. Here it is:\n<ws-structure>\n${fmtTree(res)}\n</ws-structure>\nYour result should start with <ws-structure> and end with </ws-structure>, and be in the same format.`, 
            undefined, "</ws-structure>", true, "<ws-structure>");
        summary = summary.replace(/<\/?ws-structure>/g, '').trim();
        res.summary = summary;
        res.children = [];
    }
    return res;
}

export function fmtTree(root: Directory): string {
    
    let result = root.path + '\n';
    for (const child of root.children) {
        if ('content' in child) {
            result += '  ' + child.path + '\n';
            if (child.content) {
                result += '  ' + child.content.split('\n').join('\n  ') + '\n';
            }
        } else if ('summary' in child && child.summary !== '') {
            result += '  ' + child.path + '\n  ' + child.summary + '\n';
        } else {
            result += fmtTree(child).split('\n').map(line => '  ' + line).join('\n') + '\n';
        }
    }
    return result;
}

interface ConvertedFileSystemTree {
    path: string;
    isDirectory: boolean;
    length: number;
    estimated_target_length: number;
    children?: ConvertedFileSystemTree[];
}

const DELTA: number = 100; // Example DELTA value, adjust as needed
const F_CAP: number = 1000; // Example F_CAP value, adjust as needed
const TOTAL_LENGTH: number = 5000; // Example TOTAL_LENGTH value, adjust as needed

function calculateLength(tree: FileSystemTree): number {
    if (tree.isDirectory) {
        const childrenLength = tree.children ? tree.children.reduce((sum, child) => sum + calculateLength(child), 0) : 0;
        return tree.path.length + DELTA + childrenLength;
    } else {
        const contentLength = Math.min(F_CAP, (tree.content || []).join('\n').length);
        return tree.path.length + DELTA + contentLength;
    }
}

export function convertTree(tree: FileSystemTree, totalLength: number = calculateLength(tree)): ConvertedFileSystemTree {
    const length = calculateLength(tree);
    const estimated_target_length = Math.min(length, TOTAL_LENGTH * length / totalLength);

    const convertedTree: ConvertedFileSystemTree = {
        path: tree.path,
        isDirectory: tree.isDirectory,
        length,
        estimated_target_length,
        children: tree.isDirectory && tree.children ? tree.children.map(child => convertTree(child, totalLength)) : undefined,
    };

    return convertedTree;
}

export async function getWorkspaceWithEstimations(fileSystemTree: FileSystemTree): Promise<string> {
    const convertedTree = convertTree(fileSystemTree);
    let stringified = JSON.stringify(convertedTree, null, 0);
    let response = await callOpenAIStructured(`I need you to give me a workspace structure with estimations of the target lengths for each file and directory. The lengths should add up to ${TOTAL_LENGTH}. Here is the source:\n${stringified}`, {
        "type": "object",
        "definitions": {
            "directory": {
                "type": "object",
                "properties": {
                    "type": { "const": "directory" },
                    "name": { "type": "string" },
                    "items": {
                        "type": "array",
                        "items": {
                            "oneOf": [
                                { "$ref": "#/definitions/directory" },
                                { "$ref": "#/definitions/file" }
                            ]
                        }
                    },
                    "length": { "type": "number" },
                    "estimated_target_length": { "type": "number" }
                },
                "required": ["type", "name", "items", "length", "estimated_target_length"],
                "additionalProperties": false
            },
            "file": {
                "type": "object",
                "properties": {
                    "type": { "const": "file" },
                    "name": { "type": "string" },
                    "size": { "type": "number" },
                    "length": { "type": "number" },
                    "estimated_target_length": { "type": "number" }
                },
                "required": ["type", "name", "size", "length", "estimated_target_length"],
                "additionalProperties": false
            }
        },
        "required": ["root"],
        "additionalProperties": false,
        "properties": {
            "root": { "$ref": "#/definitions/directory" }
        }
    });
    console.log(response);

    return response.root;
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
