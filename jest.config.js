// Jest configuration for Next.js with TypeScript and Node.js scripts
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'jest-environment-jsdom',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '\\.(css|less|scss|sass)$': 'identity-obj-proxy',
  },
  testMatch: [
    '**/__tests__/**/*.test.[jt]s?(x)',
    '**/?(*.)+(spec|test).[jt]s?(x)',
  ],
  collectCoverageFrom: [
    'src/**/*.{js,jsx,ts,tsx}',
    '!src/**/*.d.ts',
    '!src/**/*.stories.{js,jsx,ts,tsx}',
    '!src/**/__tests__/**',
  ],
  transform: {
    '^.+\\.(ts|tsx)$': ['ts-jest', {
      tsconfig: {
        jsx: 'react',
        esModuleInterop: true,
        allowSyntheticDefaultImports: true,
      },
    }],
    '^.+\\.js$': ['ts-jest', {
      tsconfig: {
        allowJs: true,
      },
    }],
  },
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
  globals: {
    'ts-jest': {
      tsconfig: {
        jsx: 'react',
        allowJs: true,
      },
    },
  },
  // Use projects to run different test environments
  projects: [
    // React/TypeScript tests with jsdom
    {
      displayName: 'react',
      testMatch: ['<rootDir>/src/**/__tests__/**/*.test.[jt]s?(x)'],
      testEnvironment: 'jest-environment-jsdom',
      setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
      moduleNameMapper: {
        '^@/(.*)$': '<rootDir>/src/$1',
        '\\.(css|less|scss|sass)$': 'identity-obj-proxy',
      },
      transform: {
        '^.+\\.(ts|tsx)$': ['ts-jest', {
          tsconfig: {
            jsx: 'react',
            esModuleInterop: true,
            allowSyntheticDefaultImports: true,
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
        '^.+\\.js$': 'babel-jest',
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