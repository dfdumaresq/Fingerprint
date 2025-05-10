// Set up a browser-like environment for tests only for Jest
// (this file should only be loaded by Jest, not by Hardhat)
if (typeof jest !== 'undefined') {
  global.window = {};
  global.console.log = jest.fn();
  global.console.error = jest.fn();
}