# Ingest fixtures

Small PDFs for the extraction tests (tasks 9.4 to 9.6).

| File | Purpose |
| --- | --- |
| `ok-page.pdf` | One prose page, flag `ok` |
| `eleven-pages.pdf` | 11 pages, over the 10-page selection limit |
| `over-word-limit.pdf` | 10 pages, 6,500 words, over the 6,000-word limit |
| `image-only.pdf` | One page with only an image, flag `low-text` |
| `garbled.pdf` | Prose with a broken ToUnicode map, flag `suspicious` |
| `table-like.pdf` | Twelve short rows, flag `suspicious` |
| `embedded-javascript.pdf` | Prose page with an OpenAction that runs JavaScript |
| `three-paragraphs.pdf` | Three paragraphs; the second has the break "exam-" then "ple" |
| `encrypted.pdf` | Password protected (user password `user`) |

## Regenerating

```
pnpm --filter @escape-the-crypt/web fixtures
```

This runs `generate-fixtures.ts` (Node 22 strips the types) with pdf-lib and rewrites every file above except `encrypted.pdf`.

The PDF just over 5 MiB is not committed. Tests call `buildOversizedPdf()` from `generate-fixtures.ts` to build it in memory (5,243,910 bytes, 1,030 over the limit).

## encrypted.pdf

pdf-lib cannot encrypt, so this file was made once with pypdf 7.1.1 (AES-256) from `ok-page.pdf`:

```
python -c "from pypdf import PdfReader, PdfWriter; w = PdfWriter(clone_from=PdfReader('ok-page.pdf')); w.encrypt(user_password='user', owner_password='owner', algorithm='AES-256'); w.write('encrypted.pdf')"
```

Equivalent with qpdf: `qpdf --encrypt user owner 256 -- ok-page.pdf encrypted.pdf`.
The file only needs to fail to open without a password, which pdf.js reports as `PasswordException`.