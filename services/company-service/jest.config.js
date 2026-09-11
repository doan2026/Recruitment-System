module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/../tsconfig.spec.json' }],
  },
  collectCoverageFrom: ['**/*.ts', '!**/*.spec.ts'],
  testEnvironment: 'node',
  setupFiles: ['<rootDir>/../test/unit-env.setup.js'],
};
