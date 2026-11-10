// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/test'],
  testMatch: ['**/*.test.ts'],
  // Resolve .ts before .js so tests exercise the TypeScript source, not a stale compiled lib/index.js
  moduleFileExtensions: ['ts', 'tsx', 'js', 'json', 'node'],
  transform: {
    '^.+\\.tsx?$': 'ts-jest'
  }
};
