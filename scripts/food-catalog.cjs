// Read-only: never accesses or writes the live food log.
const catalog = require('../food-catalog-v1.js');
const [command, key, amount, unit = 'g', override = '', date, meal] = process.argv.slice(2);
try {
  if (command === 'list' || command === undefined) {
    console.log(JSON.stringify({ version: catalog.version, foods: catalog.search(key) }, null, 2));
  } else if (command === 'calculate' || command === 'line') {
    const result = catalog.calculate(key, amount, unit, override);
    console.log(command === 'line' ? catalog.formatFoodLine(result, date, meal) : JSON.stringify(result, null, 2));
  } else {
    throw new Error('Use list [query], calculate ID AMOUNT [UNIT] [GRAMS_OVERRIDE], or line ID AMOUNT UNIT GRAMS_OVERRIDE DATE MEAL.');
  }
} catch (error) { console.error(error.message); process.exitCode = 1; }
