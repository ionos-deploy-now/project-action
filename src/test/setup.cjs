// @actions/core@3.x is ESM-only; pre-populate require.cache with a CJS stub
// so ts-node's CJS require can load it during tests.
const Module = require('module');

const fakeCore = {
  error: () => {},
  warning: () => {},
  info: () => {},
  debug: () => {},
  notice: () => {},
  setOutput: () => {},
  setFailed: () => {},
  getInput: () => '',
  getBooleanInput: () => false,
  getMultilineInput: () => [],
  startGroup: () => {},
  endGroup: () => {},
  group: (_name, fn) => fn(),
  saveState: () => {},
  getState: () => '',
  exportVariable: () => {},
  addPath: () => {},
  summary: { addRaw: () => ({}) },
};

const origResolve = Module._resolveFilename.bind(Module);
Module._resolveFilename = function (request, ...args) {
  if (request === '@actions/core') return '@actions/core';
  return origResolve(request, ...args);
};

require.cache['@actions/core'] = {
  id: '@actions/core',
  filename: '@actions/core',
  loaded: true,
  exports: fakeCore,
  children: [],
  paths: [],
};
