const tsConfigPaths = require('tsconfig-paths');
const { compilerOptions } = require('./tsconfig.json');

const runtimePaths = Object.fromEntries(
  Object.entries(compilerOptions.paths || {}).map(([alias, values]) => [
    alias,
    values.map((value) =>
      value
        .replace(/^src\//, '')
        .replace(/^\.\//, '')
        .replace(/\/\*$/, '/*'),
    ),
  ]),
);

tsConfigPaths.register({
  baseUrl: './dist',
  paths: runtimePaths,
});
