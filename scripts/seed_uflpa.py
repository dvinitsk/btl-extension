import re
import sys
import urllib.request
import io

PDF_URL = "https://www.govinfo.gov/content/pkg/FR-2025-01-15/pdf/2025-00901.pdf"
OUTPUT_FILE = "scripts/uflpa_insert.sql"

ALIAS_PATTERN = re.compile(
    r'\((?:also known as|formerly known as|including \w+ aliases?):?\s*([^)]+)\)',
    re.IGNORECASE
)

def download_pdf(url: str) -> bytes:
    print(f"Downloading PDF from {url}...")
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req) as response:
        return response.read()

def extract_full_text(pdf_bytes: bytes) -> str:
    try:
        import pypdf
        reader = pypdf.PdfReader(io.BytesIO(pdf_bytes))
        return "\n".join(page.extract_text() or "" for page in reader.pages)
    except ImportError:
        print("pypdf not found. Install with: pip install pypdf --break-system-packages")
        sys.exit(1)

def get_entity_list_text(full_text: str) -> str:
    """
    Extract only the text starting from 'Appendix 1' which is where
    the actual entity list begins, cutting off all preamble noise.
    """
    # Find 'Appendix 1' followed by the supersedes notice
    marker = "Appendix 1"
    idx = full_text.rfind(marker)  # use rfind to get the last occurrence
    if idx == -1:
        print("Warning: Could not find 'Appendix 1' marker")
        return full_text
    print(f"  Found 'Appendix 1' at character {idx}")
    return full_text[idx:]

def clean_text(text: str) -> str:
    """Remove Federal Register headers, VerDate lines, page numbers."""
    text = re.sub(r'\d{4} Federal Register\s*/.*?Notices\s*', ' ', text)
    text = re.sub(r'VerDate\s+\S+.*?NOTICES1\s*', ' ', text, flags=re.DOTALL)
    text = re.sub(r'lotter on\s+\S+.*?\n', ' ', text)
    return text

def split_into_raw_entries(text: str) -> list[str]:
    """
    Split text into raw entry chunks using bullet points and 
    the clean list format on pages 7-8.
    
    Strategy:
    1. Extract bullet-point entries (• Company Name)
    2. Extract entries from the consolidated list section
       which starts after 'UFLPA Section 2(d)(2)(B)(i)'
    """
    entries = []
    seen = set()

    # --- Part 1: Bullet point entries ---
    # Split on bullet character, each chunk is one entry
    bullet_parts = text.split("•")
    for part in bullet_parts[1:]:  # skip text before first bullet
        # Take only up to the next line that looks like a new section
        part = re.sub(r'\s+', ' ', part).strip()
        # Cut off at section headers
        part = re.split(r'This update also|UFLPA Section|Appendix', part)[0].strip()
        if part:
            entries.append(("bullet", part))

    # --- Part 2: Consolidated list entries ---
    # Find the section header for the full consolidated list
    section_match = re.search(
        r'UFLPA Section 2\(d\)\(2\)\(B\)\(i\)\s+A List of Entities',
        text
    )
    if section_match:
        list_text = text[section_match.start():]
        list_text = clean_text(list_text)
        lines = [l.strip() for l in list_text.split('\n') if l.strip()]

        current = None
        for line in lines:
            # Skip section headers
            if re.match(r'UFLPA Section|Entities identified|The FLETF|above may|'
                       r'continue to|information about|that meet|^Section \d', line, re.IGNORECASE):
                if current:
                    entries.append(("list", current))
                    current = None
                continue

            # New entry: starts with capital, has company suffix
            if (line[0].isupper() and
                re.search(r'Co\.|Ltd\.|Inc\.|Corp\.|Group|Center|Park|Holdings|'
                         r'Technology|Industry|Trading|Corporation|Mine|Mining|'
                         r'Textile|Silicon|Energy|Semiconductor|Foods|Logistics|XPCC', line)
                and not line.startswith("The ") and not line.startswith("These ")):
                if current:
                    entries.append(("list", current))
                current = line
            elif current:
                # Continuation line
                if (line.startswith("(") or line[0].islower() or
                    line.startswith("Ltd.") or line.startswith("Co.,") or
                    line.startswith("and ") or re.match(r'^[A-Z][a-z]+.*;', line)):
                    current += " " + line
                else:
                    entries.append(("list", current))
                    current = None

        if current:
            entries.append(("list", current))

    return entries

def parse_entry(raw: str) -> dict | None:
    raw = re.sub(r'\s+', ' ', raw).strip()
    if not raw or len(raw) < 5:
        return None

    aliases = []
    aka_match = ALIAS_PATTERN.search(raw)
    if aka_match:
        raw_aliases = aka_match.group(1)
        parts = re.split(r';\s*(?:and\s+)?|,\s*and\s+|\s+and\s+', raw_aliases)
        aliases = [
            p.strip().strip(";,").strip()
            for p in parts
            if p.strip() and len(p.strip()) > 3
        ]
        brand = raw[:aka_match.start()].strip().rstrip(".,;(").strip()
    else:
        brand = raw.strip().rstrip(".,;").strip()

    brand = re.sub(r'\s+', ' ', brand).strip()

    if not brand or len(brand) < 5:
        return None

    if not re.search(r'Co\.|Ltd\.|Inc\.|Corp\.|Group|Center|Park|Holdings|'
                    r'Technology|Industry|Trading|Corporation|Mine|Mining|'
                    r'Textile|Silicon|Energy|Semiconductor|Foods|Logistics|XPCC|'
                    r'Ninestar|Camel', brand, re.IGNORECASE):
        return None

    return {"brand": brand, "aliases": aliases}

def escape_sql(s: str) -> str:
    return s.replace("'", "''")

def generate_sql(entities: list[dict]) -> str:
    lines = [
        "-- UFLPA Entity List (January 15, 2025)",
        "-- Generated by scripts/seed_uflpa.py",
        f"-- {len(entities)} entities",
        "",
        "INSERT INTO companies (brand, aliases, product_categories, countries_of_origin, risk_level, sources, reason, last_updated)",
        "VALUES"
    ]

    rows = []
    for entity in entities:
        brand = escape_sql(entity["brand"])
        aliases = "{" + ",".join(f'"{escape_sql(a)}"' for a in entity["aliases"]) + "}"
        reason = escape_sql(
            "Listed on UFLPA Entity List. Subject to rebuttable presumption of forced labor under 19 U.S.C. § 1307."
        )
        row = (
            f"  ('{brand}', '{aliases}', '{{\"general\"}}', '{{\"CN\"}}', "
            f"'high', '{{\"UFLPA\"}}', '{reason}', '2025-01-15')"
        )
        rows.append(row)

    lines.append(",\n".join(rows) + ";")
    return "\n".join(lines)

def main():
    pdf_bytes = download_pdf(PDF_URL)
    print(f"Downloaded {len(pdf_bytes):,} bytes")

    full_text = extract_full_text(pdf_bytes)
    print(f"Extracted {len(full_text):,} characters")

    entity_text = get_entity_list_text(full_text)
    print(f"Entity list section: {len(entity_text):,} characters")

    raw_entries = split_into_raw_entries(entity_text)
    print(f"Found {len(raw_entries)} raw entries ({sum(1 for t,_ in raw_entries if t=='bullet')} bullet, {sum(1 for t,_ in raw_entries if t=='list')} list)")

    entities = []
    seen = set()
    for _, raw in raw_entries:
        entity = parse_entry(raw)
        if entity:
            key = entity["brand"].lower()
            if key not in seen:
                seen.add(key)
                entities.append(entity)

    print(f"Parsed {len(entities)} unique entities")

    if not entities:
        print("No entities found.")
        return

    sql = generate_sql(entities)
    with open(OUTPUT_FILE, "w") as f:
        f.write(sql)

    print(f"\nSQL written to {OUTPUT_FILE}")
    print("\nSample entries:")
    for e in entities[:8]:
        aka = f" (aka: {', '.join(e['aliases'])})" if e['aliases'] else ""
        print(f"  - {e['brand']}{aka}")

if __name__ == "__main__":
    main()
