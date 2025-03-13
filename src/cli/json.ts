import fs from 'fs';
import { JsonGen } from '../json/index.js';

// mute console.log
console.log = () => {};

function walkSourceFile(source: string): void {
  const fileContent = fs.readFileSync(source, 'utf-8');

  const walker = JsonGen.fromReader(fileContent);
  console.info(walker.generateSchema());
}

async function main() {
  walkSourceFile(
    '/Users/fernando/Development/Apollo/connectors/projects/JsonToConnector/src/test/resources/preferences/user/50.json',
  );
}

main().then(() => console.log('done'));
