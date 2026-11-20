# Maintainer documentation

Start with the root [project README](../README.md) for setup and capabilities. These guides describe the current implementation and the procedures needed to maintain it.

| If you need to…                                         | Read                            |
| ------------------------------------------------------- | ------------------------------- |
| Understand request flow or locate a feature             | [Architecture](ARCHITECTURE.md) |
| Change layout, styling or interaction                   | [Design](DESIGN.md)             |
| Change permissions, sessions or sensitive data handling | [Security](SECURITY.md)         |
| Set up a workstation or implement a change              | [Development](DEVELOPMENT.md)   |
| Deploy, diagnose an outage or recover data              | [Operations](OPERATIONS.md)     |
| Validate a change                                       | [Testing](TESTING.md)           |

Update the relevant guide when behavior, configuration, schema or deployment procedures change. Code and configuration are the implementation reference; documentation should explain their consequences. Do not add credentials or employee data to examples.

Host-specific TLS configuration, backup schedules and live environment values are managed outside this repository. Verify them on the host before an operational change. Historical phase plans and pre-deployment handoffs have been retired; use Git history if their context is needed.
