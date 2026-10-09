# Attribution

## Art in the office

The pixel-art office tiles, furniture and the five character pictures in `src/renderer/public/assets/pixel-office/` come from **Pixel Office by 2dPig**.

- Source: https://2dpig.itch.io/pixel-office
- Licence: CC0 1.0 Universal (public domain dedication, https://creativecommons.org/publicdomain/zero/1.0/). No attribution is required, and it is given here with thanks.
- The files were fetched from the AIOffice repository (see below) at `apps/web/public/tilesets/pixel-office/` and `apps/web/public/sprites/people/`. The pack's licence text there says it is released under CC0.

## AIOffice

**AIOffice** by Christian F. Jung (https://github.com/ChristianFJung/AIOffice, https://www.christianfjung.com/aioffice) is the reference for the look and the approach of the office view: a Phaser 3 scene with pixel-art characters at desks, which Scriptorium follows. AIOffice's code is under the MIT licence.

- Scriptorium's office scene (`src/renderer/office/`) is written from scratch. No AIOffice code is copied. Only the idea (Phaser, static character pictures scaled by height, the 2dPig atlas `PixelOfficeAssets.png`) was taken from reading `apps/web/src/game.ts`.
- If AIOffice code is copied in later, its MIT notice has to be added here:

  ```
  MIT License
  Copyright (c) Christian F. Jung
  Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction ... (full text in the AIOffice repository)
  ```

## App icon

`build/icon.ico` and `build/icon.png` (the book with a quill, also used for the tray) are drawn by code in `build/make-icon.mjs`. They are original to this project and use no downloaded art.

## Packaging

The Windows installer is made with electron-builder (MIT) and NSIS. The packaged app bundles Electron (MIT, with the Chromium and other notices in `LICENSE.electron.txt` and `LICENSES.chromium.html` next to the executable), Phaser 3 (MIT), React (MIT) and the other dependencies listed in `package.json`, each under its own licence.
