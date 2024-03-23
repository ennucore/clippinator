import { program } from 'commander';
import { Clipinator } from './clippinator';

program
  .name('clippinator')
  .description('Clippinator: Tell it what to do, and it will do it')
  .version('0.1.0');

program.command('run')
  .description('Clippinator: Tell it what to do, and it will do it')
  .argument('<objective>', 'The objective of the Clippinator')
  .argument('[path]', 'The path to the working directory', '.')
  .action((objective, path) => {
    // if objective starts with "file:", we replace it with the contents of the file
    if (objective.startsWith('file:')) {
      const fs = require('fs');
      objective = fs.readFileSync(objective.slice(5), 'utf8');
    }
    const clipinator = new Clipinator(objective, path);
    clipinator.fullCycle();
  });

program.command('simple')
  .description('Clippinator: Tell it what to do, and it will do it')
  .argument('<objective>', 'The objective of the Clippinator')
  .argument('[path]', 'The path to the working directory', '.')
  .action(async (objective, path) => {
    // if objective starts with "file:", we replace it with the contents of the file
    if (objective.startsWith('file:')) {
      const fs = require('fs');
      objective = fs.readFileSync(objective.slice(5), 'utf8');
    }
    const clipinator = new Clipinator(objective, path);
    await clipinator.simpleApproach();
  });

program.parse(process.argv);
