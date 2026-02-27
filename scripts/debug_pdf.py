import urllib.request
import pypdf
import io

PDF_URL = "https://www.govinfo.gov/content/pkg/FR-2025-01-15/pdf/2025-00901.pdf"

req = urllib.request.Request(PDF_URL, headers={"User-Agent": "Mozilla/5.0"})
with urllib.request.urlopen(req) as response:
    pdf_bytes = response.read()

reader = pypdf.PdfReader(io.BytesIO(pdf_bytes))

for i, page in enumerate(reader.pages):
    text = page.extract_text() or ""
    lines = [l.strip() for l in text.split('\n') if l.strip()]
    if lines:
        avg_len = sum(len(l) for l in lines) / len(lines)
        print(f"Page {i+1}: {len(lines)} lines, avg length {avg_len:.1f}")
