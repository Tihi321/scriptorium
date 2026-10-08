---
kind: settings
kindle_address: ""
from_address: ""
smtp_host: ""
smtp_port: 587
smtp_user: ""
smtp_secure: false
---
# Settings

Sending books to your Kindle by email.

- `kindle_address`: your Send to Kindle address (for example `yourname_123@kindle.com`).
- `from_address`: the sender address. It must be on the approved list in your Amazon account (Content & Devices, Preferences, Personal Document Settings).
- `smtp_host`, `smtp_port`, `smtp_user`, `smtp_secure`: your mail server. `smtp_secure: true` for port 465, `false` for 587 with STARTTLS.
- The password is not stored here. Enter it in the app's settings, which keeps it in the Windows credential store (account `SCRIPTORIUM_SMTP_PASSWORD`). The environment variable of the same name also works.
