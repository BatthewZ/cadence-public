# Testing

When writing tests, prioritize integration testing over heavily mocked unit tests:

- Test real interactions between components rather than isolated units with mocks
- Only mock external dependencies (APIs, databases) when absolutely necessary
- Test the actual integration points where bugs commonly occur
- If you must mock, mock at the boundaries (external services) not internal components
- Write tests that exercise the same code paths users will actually use

**IMPORTANT:** NEVER USE `... || true` IN ASSERTIONS. IT HIDES THE SIGNAL AND MAKES THE TEST REDUNDANT AND I WILL FIGHT YOU IF YOU DO IT.

NEVER WRAP ASSERTIONS IN `if (isVisible)` OR SIMILAR GUARDS. It hides the signal and makes the test. AND I WILL FIGHT YOU IF YOU DO IT.

Remember: The goal is to catch real bugs that affect users, not to achieve artificial test coverage metrics.

NOTE: Beyond our primary goal, we are also creating a self-healing and self-correcting agentic loop where each agent must leave insights and feedback in the form of testing and documentation for future agents to be able to understand.

Be sure to include cleanup in each e2e test to prevent memory leaks.

**CRITICAL** Never filter out fetch errors or API errors when writing tests.

Is it a good idea to test something visually? If so, read [screenshots-test.md](./screenshot-test.md)
