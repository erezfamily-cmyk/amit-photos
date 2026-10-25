import { dbName, snapshot } from './d1lib.mjs';
console.log(await dbName());
console.log(JSON.stringify(await snapshot()));
