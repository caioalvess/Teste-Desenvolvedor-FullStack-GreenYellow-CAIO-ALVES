/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src', '<rootDir>/test'],
  testMatch: ['**/*.spec.ts'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.spec.ts',
    '!src/**/entities/*.ts',
    '!src/main.ts',
    '!src/app.module.ts',
  ],
  coverageDirectory: 'coverage',
  maxWorkers: 1,
  testTimeout: 30000,
};
