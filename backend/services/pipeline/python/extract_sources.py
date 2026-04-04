import json
import os
import re
import sys
import tempfile


def normalize_whitespace(text):
    if not text:
        return ""
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    lines = [re.sub(r"\s+", " ", line).strip() for line in text.split("\n")]
    lines = [line for line in lines if line]
    return "\n".join(lines).strip()


def detect_repeated_edges(page_lines):
    if len(page_lines) < 2:
        return set(), set()
    header_counts = {}
    footer_counts = {}
    for lines in page_lines:
        if lines:
            header = lines[0]
            footer = lines[-1]
            header_counts[header] = header_counts.get(header, 0) + 1
            footer_counts[footer] = footer_counts.get(footer, 0) + 1
    min_repeats = max(2, len(page_lines) // 2)
    repeated_headers = {line for line, count in header_counts.items() if count >= min_repeats}
    repeated_footers = {line for line, count in footer_counts.items() if count >= min_repeats}
    return repeated_headers, repeated_footers


def strip_repeated_edges(lines, repeated_headers, repeated_footers):
    if not lines:
        return lines
    cleaned = list(lines)
    if cleaned and cleaned[0] in repeated_headers:
        cleaned = cleaned[1:]
    if cleaned and cleaned[-1] in repeated_footers:
        cleaned = cleaned[:-1]
    return cleaned


def safe_imports():
    state = {"fitz": None, "pytesseract": None, "Image": None, "warnings": []}
    try:
        import fitz  # type: ignore
        state["fitz"] = fitz
    except Exception as exc:
        state["warnings"].append(f"PyMuPDF unavailable: {exc}")
    try:
        import pytesseract  # type: ignore
        from PIL import Image  # type: ignore

        tesseract_cmd = os.environ.get("TESSERACT_CMD")
        if tesseract_cmd and os.path.exists(tesseract_cmd):
            pytesseract.pytesseract.tesseract_cmd = tesseract_cmd
        elif os.name == "nt":
            default_win_path = r"C:\Program Files\Tesseract-OCR\tesseract.exe"
            if os.path.exists(default_win_path):
                pytesseract.pytesseract.tesseract_cmd = default_win_path

        state["pytesseract"] = pytesseract
        state["Image"] = Image
    except Exception as exc:
        state["warnings"].append(f"OCR libraries unavailable: {exc}")
    return state


def ocr_image(path, libs):
    if not libs["pytesseract"] or not libs["Image"]:
        return "", ["OCR not available for image extraction."]
    warnings = []
    try:
        image = libs["Image"].open(path)
        text = libs["pytesseract"].image_to_string(image)
        return normalize_whitespace(text), warnings
    except Exception as exc:
        warnings.append(f"OCR failed for image: {exc}")
        return "", warnings


def extract_pdf(file_entry, libs):
    sources = []
    warnings = []
    if not libs["fitz"]:
        return sources, [f"Cannot parse {file_entry['filename']}: PyMuPDF not available."]

    fitz = libs["fitz"]
    doc = None
    try:
        doc = fitz.open(file_entry["path"])
        page_line_sets = []
        raw_pages = []
        for page_index in range(len(doc)):
            page = doc[page_index]
            raw_text = normalize_whitespace(page.get_text("text"))
            raw_pages.append(raw_text)
            page_line_sets.append(raw_text.split("\n") if raw_text else [])

        repeated_headers, repeated_footers = detect_repeated_edges(page_line_sets)

        for page_index in range(len(doc)):
            page = doc[page_index]
            raw_text = raw_pages[page_index]
            page_warnings = []
            lines = raw_text.split("\n") if raw_text else []
            cleaned_lines = strip_repeated_edges(lines, repeated_headers, repeated_footers)
            embedded_text = normalize_whitespace("\n".join(cleaned_lines))
            final_text = embedded_text
            confidence = 0.9 if embedded_text else 0.1

            if len(embedded_text) < 80:
                if libs["pytesseract"] and libs["Image"]:
                    tmp_png = None
                    try:
                        pix = page.get_pixmap(matrix=fitz.Matrix(2, 2))
                        with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as handle:
                            tmp_png = handle.name
                        pix.save(tmp_png)
                        ocr_text, ocr_warnings = ocr_image(tmp_png, libs)
                        page_warnings.extend(ocr_warnings)
                        if len(ocr_text) > len(embedded_text):
                            final_text = ocr_text
                            confidence = 0.7 if ocr_text else confidence
                        if not ocr_text and not embedded_text:
                            page_warnings.append("No readable text found on PDF page.")
                    except Exception as exc:
                        page_warnings.append(f"OCR fallback failed on page {page_index + 1}: {exc}")
                    finally:
                        if tmp_png and os.path.exists(tmp_png):
                            try:
                                os.remove(tmp_png)
                            except Exception:
                                pass
                else:
                    page_warnings.append("OCR fallback unavailable for low-text PDF page.")

            sources.append(
                {
                    "type": "pdf",
                    "filename": file_entry["filename"],
                    "index": page_index,
                    "extractedText": final_text,
                    "confidence": confidence,
                    "warnings": page_warnings,
                }
            )
    except Exception as exc:
        warnings.append(f"PDF extraction failed for {file_entry['filename']}: {exc}")
    finally:
        if doc:
            doc.close()

    return sources, warnings


def extract_image(file_entry, libs):
    text, page_warnings = ocr_image(file_entry["path"], libs)
    confidence = 0.7 if text else 0.1
    return {
        "type": "image",
        "filename": file_entry["filename"],
        "index": file_entry.get("index", 0),
        "extractedText": text,
        "confidence": confidence,
        "warnings": page_warnings,
    }


def main():
    if len(sys.argv) < 2:
        print(json.dumps({"sources": [], "warnings": ["Manifest path is required."]}))
        return

    manifest_path = sys.argv[1]
    try:
        with open(manifest_path, "r", encoding="utf-8") as handle:
            manifest = json.load(handle)
    except Exception as exc:
        print(json.dumps({"sources": [], "warnings": [f"Failed to read manifest: {exc}"]}))
        return

    files = manifest.get("files", [])
    libs = safe_imports()
    all_warnings = list(libs["warnings"])
    sources = []

    for file_entry in files:
        mimetype = (file_entry.get("mimetype") or "").lower()
        if mimetype == "application/pdf":
            pdf_sources, warnings = extract_pdf(file_entry, libs)
            sources.extend(pdf_sources)
            all_warnings.extend(warnings)
        elif mimetype.startswith("image/"):
            sources.append(extract_image(file_entry, libs))
        else:
            all_warnings.append(
                f"Skipped unsupported mimetype {mimetype or 'unknown'} for {file_entry.get('filename', 'file')}."
            )

    print(json.dumps({"sources": sources, "warnings": all_warnings}))


if __name__ == "__main__":
    main()
