import Handlebars from "handlebars"
import { Template } from "handlebars"
import * as yaml from 'js-yaml';
import * as fs from 'fs';

export class PromptManager {
    prompts: Record<string, Template>
    constructor() {
        this.prompts = {}
    }

    registerPrompt(name: string, template: string) {
        Handlebars.registerHelper('include', function (file: string) {
            return fs.readFileSync(file, 'utf8');
        });
        this.prompts[name] = Handlebars.compile(template);
    }

    loadYaml(yaml_path: string) {
        let yaml_str = fs.readFileSync(yaml_path, 'utf8');
        let yaml_obj: any = yaml.load(yaml_str);
        for (let key in yaml_obj) {
            this.registerPrompt(key, yaml_obj[key])
        }
        return this;
    }

    getPrompt(name: string, data: any): string {
        let template: Handlebars.Template | null = this.prompts.hasOwnProperty(name) ? this.prompts[name] : null;
        if (template == null) {
            throw new Error(`Prompt ${name} not found`)
        }
        let res = (template as any)(data);
        return res
    }
}

