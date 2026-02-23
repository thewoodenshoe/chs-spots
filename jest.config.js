// Jest configuration for Next.js with TypeScript and Node.js scripts
module.exports = {
  // Use projects to run different test environments
  projects: [
    // React/TypeScript tests with jsdom
    {
      displayName: 'react',
      testMatch: ['<rootDir>/src/**/__tests__/**/*.test.[jt]s?(x)'],
      testEnvironment: 'jest-environment-jsdom',
      setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
      maxWorkers: 1, // Run tests sequentially to reduce memory usage
      moduleNameMapper: {
        '^@/(.*)$': '<rootDir>/src/$1',
        '\\.(css|less|scss|sass)$': 'identity-obj-proxy',
      },
      transform: {
        '^.+\\.tsx?$': ['ts-jest', {
          tsconfig: {
            jsx: 'react-jsx',
            target: 'ES2017',
            module: 'commonjs',
            esModuleInterop: true,
            allowSyntheticDefaultImports: true,
            moduleResolution: 'node',
            resolveJsonModule: true,
            isolatedModules: true,
            strict: true,
            noEmit: true,
            paths: { '@/*': ['./src/*'] },
          },
        }],
        '^.+\\.js$': ['ts-jest', {
          tsconfig: {
            allowJs: true,
          },
        }],
      },
      moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
    },
    // Node.js script tests
    {
      displayName: 'node',
      testMatch: [
        '<rootDir>/scripts/**/__tests__/**/*.test.js',
        '<rootDir>/__tests__/**/*.test.ts',
        '<rootDir>/__tests__/**/*.test.js',
      ],
      testEnvironment: 'node',
      transform: {
        '^.+\\.js$': ['ts-jest', {
          tsconfig: {
            allowJs: true,
          },
        }],
        '^.+\\.ts$': ['ts-jest', {
          tsconfig: {
            allowJs: true,
          },
        }],
      },
      moduleFileExtensions: ['js', 'ts', 'json'],
    },
  ],
}