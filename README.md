# Kleo Web

A 100% local OpenPGP key manager that runs in your browser. Manage your private and public keys, encrypt and sign messages or files, and decrypt and verify what you receive, with no account, no server and no network access.

Built on [OpenPGP.js](https://openpgpjs.org/) v5, with no build step and no dependencies to install.

## Features

**Keys**
- Create key pairs (ECC Curve25519 or RSA 4096), with an optional expiry date
- Import private and public keys (armored text or binary files, several at once)
- Give each key a custom name so you know who is who
- Unlock and lock private keys per key, with auto-lock after inactivity
- Change or add a passphrase
- Export public keys, back up private keys, download a revocation certificate for new keys
- Back up the whole vault to a single file

**Encrypt / Sign**
- Text or files (drag and drop)
- Encrypt for saved contacts, or paste someone's public key for a one-off message
- Also encrypt for yourself, so you can read it later
- Password-based encryption, alone or together with keys
- Clear-signed messages and detached signatures (`.sig` / `.asc`)
- Armored (`.asc`) or binary (`.gpg`) output

**Decrypt / Verify**
- Automatically picks the right private key and asks for its passphrase only when needed
- Verifies signatures inside encrypted messages, clear-signed messages and detached signatures
- Clear results: good signature, bad signature, or signed by an unknown key
- Decrypted files can be downloaded with their original name
- Paste a key by mistake and it offers to import it

## Getting started

You need [Node.js](https://nodejs.org/) 14 or newer. There is nothing to install.

```bash
git clone https://github.com/<your-username>/kleo-web.git
cd kleo-web
npm start
```

Then open http://127.0.0.1:8765. To use another port, set `PORT`, for example `PORT=9000 npm start`.

The server listens on `127.0.0.1` only, so the app is not reachable from other machines on your network.

## Security model

- **Everything happens in the browser.** Keys, messages and files are processed locally by OpenPGP.js.
- **No network access.** The page's Content Security Policy sets `connect-src 'none'`, so the app itself cannot send anything anywhere. Scripts can only be loaded from the app's own files.
- **Private keys stay encrypted at rest.** They are stored in the browser's `localStorage` only in their passphrase-protected form. A private key imported without a passphrase is kept for the current session only, until you give it one.
- **Unlocked keys live only in memory.** They are cleared when you lock them, when you close the page, or after the auto-lock delay.
- **No dependencies at runtime** other than the bundled `lib/openpgp.min.js`.

### Things to keep in mind

- `localStorage` belongs to your browser profile. Clearing site data deletes your keys, so **keep a backup** (Settings → Backup).
- Anyone with access to your browser profile can copy your encrypted private keys. Their safety then depends on the strength of your passphrase.
- Browser extensions with access to the page can read what it displays. Use a clean browser profile for sensitive work.
- This project has not been independently audited. For high-risk use, prefer a mature tool such as GnuPG.

## Project structure

```
index.html            App layout and Content Security Policy
style.css             Styles
app.js                All app logic
serve.js              Minimal local static server (serves only the files above)
lib/openpgp.min.js    OpenPGP.js 5.11.2 (browser build)
lib/OPENPGP-LICENSE   OpenPGP.js license (LGPL-3.0)
```

## Updating OpenPGP.js

```bash
npm pack openpgp@5
tar -xzf openpgp-*.tgz package/dist/openpgp.min.js package/LICENSE
mv package/dist/openpgp.min.js lib/openpgp.min.js
mv package/LICENSE lib/OPENPGP-LICENSE
rm -rf package openpgp-*.tgz
```

## License

The app's code is released under the [MIT License](LICENSE). The bundled OpenPGP.js is licensed under the [LGPL-3.0](lib/OPENPGP-LICENSE).
