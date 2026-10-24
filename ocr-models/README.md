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

To replace a model, keep the file names, update the hashes here and run `npm test` (the receipt tests read real
rendered receipts with these models).
