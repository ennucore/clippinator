import { program } from 'commander';
import { Clipinator } from './clippinator';

program
  .name('clippinator')
  .description('Clippinator: Tell it what to do, and it will do it')
  .version('0.1.0');

program.command('run')
  .description('Start the Clippinator')
  .argument('<objective>', 'The objective of the Clippinator')
  .argument('[path]', 'The path to the working directory', '.')
  .action((objective, path) => {
    const clipinator = new Clipinator(objective, path);
    clipinator.run();
  });

program.parse(process.argv);
