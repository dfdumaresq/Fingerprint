# Secure Key Management & Blockchain Test Suite

This directory contains tests for the secure key management system and blockchain integration. The tests ensure that the security components work as expected and follow OWASP key management guidelines.

## Overview

The test suite includes:

1. **Unit tests for KeyProvider implementations**
   - Tests for MockKeyProvider (used for testing)
   - Tests for EnvKeyProvider
   - Tests for class method behavior

2. **Unit tests for KeyManager and KeyProviderFactory**
   - Tests for singleton pattern
   - Tests for initialization logic
   - Tests for key operations
   - Tests for provider creation

3. **Unit tests for AuditLogger**
   - Tests for logging methods
   - Tests for configuration
   - Tests for environment detection

4. **Integration tests for SecureBlockchainService**
   - Tests for secure wallet connection
   - Tests for blockchain operations using secure keys
   - Tests for EIP-712 signature generation and verification

## Running Tests

To run the tests, use the following command:

```bash
npm test
```

Or to run specific test suites:

```bash
npm test -- -t "KeyProvider"  # Run only KeyProvider tests
npm test -- -t "AuditLogger"  # Run only AuditLogger tests
npm test -- -t "SecureBlockchainService"  # Run only SecureBlockchainService tests
```

## Mock Implementations

The tests use mock implementations to avoid external dependencies:

1. **MockKeyProvider**: An in-memory implementation of the KeyProvider interface for testing.
2. **Jest mocks**: Used for ethers.js, KeyManager, and AuditLogger to isolate components during testing.

## Test Organization

The tests are organized by component:

- `/test/mocks/`: Contains mock implementations for testing
- `/test/security/`: Contains tests for the security module
- `/test/services/`: Contains tests for services that use the security module

## Adding New Tests

When adding new tests:

1. Create test files matching the pattern `*.test.ts` in the appropriate directory.
2. Use Jest's describe/it pattern for test organization.
3. Mock external dependencies to isolate the component being tested.
4. Include tests for both normal usage and error handling.

## Test Coverage

The test suite aims to cover:

- All public methods of security components
- Error handling and edge cases
- Environment detection and browser/Node.js compatibility
- Integration between components

## Best Practices

The tests follow these best practices:

1. **Isolation**: Each test runs in isolation with mocked dependencies.
2. **Cleanup**: Tests clean up after themselves to avoid affecting other tests.
3. **Readable assertions**: Test assertions clearly indicate what is being tested.
4. **Complete coverage**: All methods and code paths are tested.

## Mocking Guidelines

When mocking components:

1. Use `jest.mock()` for module-level mocking.
2. Use `jest.spyOn()` for monitoring method calls without changing behavior.
3. Mock only what's necessary to isolate the component being tested.
4. Reset mocks between tests to avoid cross-test contamination.