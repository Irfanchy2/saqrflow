# Local OCR models

Averiqo reads photos (receipts, IDs, scanned documents) on its own server with
[PaddleOCR](https://github.com/PaddlePaddle/PaddleOCR) before it uses any paid service. Nothing is sent outside the server.

| File | Model | SHA-256 |
| --- | --- | --- |
| `ppocrv6-small/det.onnx` | PP-OCRv6 small text detection | `090f04abcd9d9a7498bc4ebf677e4cb9bdce1fe4197ddb7e529f1ef44e1ff94f` |
| `ppocrv6-small/rec.onnx` | PP-OCRv6 small text recognition (multilingual: English, digits, symbols, Chinese, Japanese) | `6f327246b50388f3c176ae304bd95767ea6dc0c9ae92153ef8cbe210b3c14884` |
| `ppocrv6-small/dict.txt` | The recognition model's character list (read from the model's own `character` metadata) | `b5f2bfe2bdd9448429e3e82b51c789775d9b42f2403d082b00662eb77e401c5d` |

- **Where they come from:** PaddlePaddle's official PP-OCRv6 models in ONNX form, as published by RapidAI in
  `rapidocr` 3.10.0 on PyPI (`rapidocr/models/PP-OCRv6_det_small.onnx` and `PP-OCRv6_rec_small.onnx`). The hashes
  above match the SHA-256 values in that release's `default_models.yaml`.
- **Licence:** Apache-2.0 (PaddleOCR and RapidOCR).
- **How they run:** the [`paddleocr`](https://www.npmjs.com/package/paddleocr) npm runtime (pre/post-processing) on
  `onnxruntime-node` (CPU). See `lib/ai/ocr/paddle.ts`. Tesseract (`tesseract.js`) stays as the fallback.
- **Arabic:** these models do not read Arabic letters. Arabic receipts fall back to the cloud OCR / Google AI when they
  are set up; numbers on Arabic receipts are still read.

## Tiny models (turbo, downloaded at build time)

Receipts are read first with the PP-OCRv6 **tiny** models, about 3× faster: a 12 MP phone photo takes ~1.5 s on one CPU
instead of ~4.4 s. When that reading is not complete (amounts that do not add up, a TRN that could not be read…) the
small models above read it again.

The tiny models are **not** in the repository. `npm run build` runs `scripts/fetch-ocr-models.mjs` first, which downloads
them from RapidAI's official RapidOCR store (ModelScope, release v3.10.0) into `ppocrv6-tiny/` and keeps them only when
their SHA-256 matches RapidAI's published value:

| File | Source | SHA-256 |
| --- | --- | --- |
| `ppocrv6-tiny/det.onnx` | `onnx/PP-OCRv6/det/PP-OCRv6_det_tiny.onnx` | `f42c0fbd294d95eac1a550e131b277dac97462c8025fa4b6c3cec1b7894bd3d5` |
| `ppocrv6-tiny/rec.onnx` | `onnx/PP-OCRv6/rec/PP-OCRv6_rec_tiny.onnx` | `e16e242de5937ad92609223f19bc2aff3727ee40b095f996907c24749bad251b` |
| `ppocrv6-tiny/dict.txt` | read from the recognition model's own `character` metadata (6,904 characters) | |

If the download fails or a hash does not match, nothing is installed, the build continues and receipts are read with
the small models (as before). Set `SAQRFLOW_SKIP_TINY_OCR=1` to skip the download.

To replace a model, keep the file names, update the hashes here and run `npm test` (the receipt tests read real
rendered receipts with these models).
