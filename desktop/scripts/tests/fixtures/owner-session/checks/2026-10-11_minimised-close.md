# Check: minimised close (fixture, older style of template)

Result: [ ] PASS   [ ] FAIL   Status: NOT RUN

## Purpose

Close the app from the taskbar while it is minimised, then start it again.

## Build under test

| Field | Entry |
| --- | --- |
| Run date | |
| Installer SHA-256 | 2f4b5c4cdf37a5a520be4517d7efd725288ac9ae28b047e85b302e9f52c4b590 |
| Release commit | installed tag and release commit (desktop/scripts/owner-session.ps1 fills this) |

## Pass rule

PASS when the window comes back maximised.
