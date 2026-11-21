# Maintainer documentation

Start with the root [project README](../README.md) for setup and capabilities. These guides describe the current implementation and the procedures needed to maintain it.

| If you need to…                                          | Read                            |
| -------------------------------------------------------- | ------------------------------- |
| Understand request flow or locate a feature              | [Architecture](ARCHITECTURE.md) |
| Change layout, styling or interaction                    | [Design](DESIGN.md)             |
| Change permissions, sessions or sensitive data handling  | [Security](SECURITY.md)         |
| Set up a workstation or implement a change               | [Development](DEVELOPMENT.md)   |
| Run or validate the Workers preview                      | [Operations](OPERATIONS.md)     |
| Validate a change                                        | [Testing](TESTING.md)           |
| Review local timing, D1 consumption and release criteria | [Performance](PERFORMANCE.md)   |
| Prepare an approved public source snapshot               | [Publication](PUBLICATION.md)   |

Update the relevant guide when behavior, configuration, schema or deployment procedures change. Code and configuration are the implementation reference; documentation should explain their consequences. Do not add credentials or employee data to examples.

Architecture, Security and Testing cover both implementations. Development focuses on the Node/PostgreSQL reference setup. Operations covers the Workers demo and staging.
