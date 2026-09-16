# Security

## Private keys

REACTOR encrypts the imported private key with Electron `safeStorage`. On Windows this uses operating system protected storage. The key is never written to logs or returned to the renderer after import.

Use a dedicated trading wallet. Keep only the amount needed for active trades in it.

## Reporting

Do not open a public issue for a vulnerability that could expose funds. Use GitHub private vulnerability reporting for the repository.
